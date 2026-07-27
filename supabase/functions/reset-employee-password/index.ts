// =====================================================================
// EDGE FUNCTION: reset-employee-password
// Chạy trên server của Supabase (Deno), dùng service_role key — KHÔNG
// bao giờ đưa service_role key vào code frontend.
// Việc: TECH (hoặc Executive) đặt lại mật khẩu TẠM cho 1 nhân viên đã
// có tài khoản (trường hợp nhân viên quên mật khẩu, không tự đăng nhập
// được để đổi mật khẩu như bình thường) — dùng chung cách sinh mật khẩu
// ngẫu nhiên an toàn (CSPRNG) và cờ "temp_password_flag" đã có sẵn từ
// hàm create-employee-account, để nhất quán trong toàn hệ thống.
//
// Deploy: supabase functions deploy reset-employee-password
// Env cần set (Supabase Dashboard → Edge Functions → Secrets):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// =====================================================================
import { serve } from 'https://deno.land/std@0.203.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// CSPRNG — giống hệt create-employee-account, 10 ký tự, loại ký tự dễ
// nhầm lẫn khi Tech đọc/gõ lại cho nhân viên (0/O, 1/l/I).
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

    const { data: userData, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !userData.user) {
      return jsonResponse({ error: 'Không xác thực được người gọi.' }, 401);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Chi TECH hoac EXECUTIVE moi duoc dat lai mat khau ho nguoi khac —
    // day la thao tac nhay cam (chiem duoc tai khoan nguoi khac neu bi
    // lam dung), nen KHONG mo rong cho Truong/Pho phong nhu tao nhan
    // vien moi.
    const { data: callerEmployee } = await admin
      .from('employees')
      .select('id, system_roles(code)')
      .eq('auth_user_id', userData.user.id)
      .single();

    const callerRoleCode = callerEmployee?.system_roles?.code;
    const allowed = callerRoleCode === 'TECH' || callerRoleCode === 'EXECUTIVE';
    if (!allowed) {
      return jsonResponse({ error: 'Chỉ Kỹ thuật hoặc Ban điều hành mới được đặt lại mật khẩu cho người khác.' }, 403);
    }

    const { employee_id } = await req.json();
    if (!employee_id) {
      return jsonResponse({ error: 'Thiếu mã nhân viên cần đặt lại mật khẩu.' }, 400);
    }

    const { data: targetEmployee, error: targetErr } = await admin
      .from('employees')
      .select('id, full_name, auth_user_id, employee_code')
      .eq('id', employee_id)
      .single();

    if (targetErr || !targetEmployee) {
      return jsonResponse({ error: 'Không tìm thấy nhân viên này.' }, 404);
    }
    if (!targetEmployee.auth_user_id) {
      return jsonResponse({ error: 'Nhân viên này chưa có tài khoản đăng nhập.' }, 400);
    }

    const tempPassword = randomTempPassword();

    const { error: updateErr } = await admin.auth.admin.updateUserById(
      targetEmployee.auth_user_id,
      { password: tempPassword },
    );
    if (updateErr) {
      return jsonResponse({ error: 'Đặt lại mật khẩu thất bại: ' + updateErr.message }, 400);
    }

    // Danh dau nhu mat khau tam, giong het khi tao nhan vien moi — de
    // he thong (neu co man hinh "doi mat khau bat buoc" sau dang nhap)
    // biet ma nhac nhan vien doi lai mat khau rieng.
    await admin.from('employees').update({ temp_password_flag: true }).eq('id', employee_id);

    // Ghi log hanh dong nhay cam nay de sau co the tra soat (ai dat lai
    // mat khau cho ai, luc nao) — dung bang activity_logs da co san.
    await admin.from('activity_logs').insert({
      employee_id: callerEmployee.id,
      action: 'reset_employee_password',
      entity_type: 'employees',
      entity_id: employee_id,
      detail: { target_name: targetEmployee.full_name, target_code: targetEmployee.employee_code },
    }).catch(() => null); // khong chan luong chinh neu ghi log loi

    return jsonResponse({
      success: true,
      employee_code: targetEmployee.employee_code,
      full_name: targetEmployee.full_name,
      temp_password: tempPassword, // hien 1 lan duy nhat cho Tech de bao lai cho nhan vien
    }, 200);

  } catch (e) {
    return jsonResponse({ error: e.message || 'Lỗi không xác định.' }, 500);
  }
});
