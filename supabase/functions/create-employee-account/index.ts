// =====================================================================
// EDGE FUNCTION: create-employee-account
// Chạy trên server của Supabase (Deno), dùng service_role key — KHÔNG
// bao giờ đưa service_role key vào code frontend.
// Việc: tạo tài khoản auth.users với mật khẩu tạm ngẫu nhiên, rồi tạo
// dòng employees tương ứng (mã AIS-000x tự sinh qua trigger DB).
// Chỉ HR/Executive/Tech mới được gọi (kiểm tra qua JWT của người gọi).
//
// Deploy: supabase functions deploy create-employee-account
// Env cần set (Supabase Dashboard → Edge Functions → Secrets):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// =====================================================================
import { serve } from 'https://deno.land/std@0.203.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// ---------------------------------------------------------------------
// CORS: cần thiết vì frontend (localhost:3000 / domain production) gọi
// function này bằng fetch() từ trình duyệt. Trình duyệt sẽ gửi 1 request
// OPTIONS "preflight" trước — nếu không trả về đúng header + status 2xx,
// request POST thật sự sẽ KHÔNG bao giờ được gửi đi (lỗi hiện tại).
// ---------------------------------------------------------------------
const corsHeaders = {
  'Access-Control-Allow-Origin': '*', // production nên đổi thành domain cụ thể
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function randomTempPassword() {
  return Math.random().toString(36).slice(-6) + Math.floor(Math.random() * 90 + 10);
}

serve(async (req) => {
  // Trả lời preflight request trước bất kỳ logic nào khác (kể cả auth),
  // vì request OPTIONS của trình duyệt KHÔNG mang theo Authorization header.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    // Xác thực người gọi + kiểm tra quyền (HR / Executive / Tech)
    const { data: userData, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !userData.user) {
      return jsonResponse({ error: 'Không xác thực được người gọi.' }, 401);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: callerEmployee } = await admin
      .from('employees')
      .select('id, department_id, role_id, departments(code), system_roles(code)')
      .eq('auth_user_id', userData.user.id)
      .single();

    const callerRoleCode = callerEmployee?.system_roles?.code;
    const callerDeptCode = callerEmployee?.departments?.code;
    const allowed = callerRoleCode === 'TECH' || callerRoleCode === 'EXECUTIVE' ||
      (callerDeptCode === 'HR' && ['DEPT_HEAD', 'DEPT_DEPUTY'].includes(callerRoleCode));
    if (!allowed) {
      return jsonResponse({ error: 'Bạn không có quyền tạo nhân viên mới.' }, 403);
    }

    const { email, employee } = await req.json();
    if (!email || !employee?.full_name) {
      return jsonResponse({ error: 'Thiếu dữ liệu email hoặc họ tên.' }, 400);
    }

    const tempPassword = randomTempPassword();

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
    });
    if (createErr) {
      return jsonResponse({ error: 'Tạo tài khoản thất bại: ' + createErr.message }, 400);
    }

    const { data: newEmployee, error: insertErr } = await admin
      .from('employees')
      .insert({ ...employee, auth_user_id: created.user.id, temp_password_flag: true, status: 'active' })
      .select('id, employee_code')
      .single();

    if (insertErr) {
      // rollback tài khoản auth vừa tạo nếu insert employees thất bại
      await admin.auth.admin.deleteUser(created.user.id);
      return jsonResponse({ error: 'Tạo hồ sơ nhân viên thất bại: ' + insertErr.message }, 400);
    }

    // TODO: gửi tempPassword qua kênh nội bộ an toàn (thông báo hệ thống /
    // email thật của nhân viên), KHÔNG trả trực tiếp cho frontend log lại.
    return jsonResponse({
      success: true,
      employee_code: newEmployee.employee_code,
      temp_password: tempPassword, // hiển thị 1 lần cho HR để giao cho nhân viên
    }, 200);

  } catch (e) {
    return jsonResponse({ error: e.message || 'Lỗi không xác định.' }, 500);
  }
});