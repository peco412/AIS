// =====================================================================
// EDGE FUNCTION: create-employee-account
// Chạy trên server của Supabase (Deno), dùng service_role key — KHÔNG
// bao giờ đưa service_role key vào code frontend.
// Việc: tạo tài khoản auth.users với mật khẩu tạm ngẫu nhiên, rồi tạo
// dòng employees tương ứng (mã AIS-000x tự sinh qua trigger DB).
// Chỉ HR/Executive/Tech mới được gọi (kiểm tra qua JWT của người gọi).
//
// BẢN VÁ 16/07/2026 (xem AUDIT_ERP_AIS_2026-07-16.md mục B.4):
// 1) MASS ASSIGNMENT: bản cũ dùng `{ ...employee, ... }` — spread thẳng
//    body người gọi gửi lên vào insert, nghĩa là một HR Trưởng/phó phòng
//    (đã được phép gọi hàm này) có thể gửi kèm các cột KHÔNG nằm trong
//    form tạo nhân viên thật (id, employee_code, auth_user_id...) nếu họ
//    biết tên cột. Sửa: WHITELIST rõ ràng đúng các trường mà
//    app/hr/employees.js thực sự gửi lên, bỏ hết phần còn lại.
// 2) RNG YẾU: randomTempPassword() cũ dùng Math.random() — không phải
//    CSPRNG, độ dài/độ phức tạp không đảm bảo. Sửa: dùng
//    crypto.getRandomValues (Deno có sẵn), sinh đủ 10 ký tự từ bảng chữ
//    đã loại các ký tự dễ nhầm (0/O, 1/l/I).
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
// function này bằng fetch() từ trình duyệt.
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

// ---------------------------------------------------------------------
// Danh sách CHÍNH XÁC các trường mà app/hr/employees.js gửi lên khi tạo
// nhân viên mới (xem hàm submit của form Nhân viên). Bất kỳ trường nào
// KHÔNG có trong danh sách này sẽ bị bỏ qua, dù client có gửi lên hay
// không — chặn việc chèn thêm cột nhạy cảm (id, employee_code,
// auth_user_id, temp_password_flag, status ép cứng riêng bên dưới).
// ---------------------------------------------------------------------
const ALLOWED_EMPLOYEE_FIELDS = [
  'full_name', 'phone', 'email', 'dob',
  'department_id', 'position_id', 'center_id', 'role_id',
  'status', 'contract_type', 'hire_date',
  'is_foreign_teacher', 'is_academic_board', 'can_teach',
  'hometown', 'id_card_number', 'address',
  'emergency_contact_name', 'emergency_contact_phone', 'note',
] as const;

function whitelistEmployeeFields(input: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const key of ALLOWED_EMPLOYEE_FIELDS) {
    if (input?.[key] !== undefined) out[key] = input[key];
  }
  return out;
}

// CSPRNG — thay cho Math.random(). 10 ký tự, loại bỏ ký tự dễ nhầm lẫn
// khi HR đọc/gõ lại cho nhân viên (0/O, 1/l/I).
const TEMP_PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
function randomTempPassword(length = 10): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += TEMP_PASSWORD_ALPHABET[bytes[i] % TEMP_PASSWORD_ALPHABET.length];
  }
  return out;
}

serve(async (req) => {
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

    const safeEmployeeFields = whitelistEmployeeFields(employee);

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
      .insert({ ...safeEmployeeFields, auth_user_id: created.user.id, temp_password_flag: true, status: 'active' })
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
