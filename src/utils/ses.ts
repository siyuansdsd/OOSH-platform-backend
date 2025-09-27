import nodemailer from "nodemailer";

const smtpHost = process.env.SMTP_HOST;
const smtpPort = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587;
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;
const smtpSecure = process.env.SMTP_SECURE
  ? process.env.SMTP_SECURE === "true"
  : smtpPort === 465 || smtpPort === 2465;

type NodemailerTransporter = import("nodemailer").Transporter;

let smtpTransporter: NodemailerTransporter | null = null;
if (smtpHost && smtpPort && smtpUser && typeof smtpPass === "string") {
  smtpTransporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  });
}

function maskEmail(e?: string | undefined) {
  if (!e) return undefined;
  const at = e.indexOf("@");
  if (at === -1) return e;
  const user = e.slice(0, at);
  const domain = e.slice(at + 1);
  if (!user) return `*@${domain}`;
  if (user.length <= 2) return `**@${domain}`;
  return `${user[0]}***${user[user.length - 1]}@${domain}`;
}

/**
 * 发送验证邮件，并记录尝试/成功/失败的简要日志（避免记录敏感凭据）
 */
export async function sendVerificationEmail(to: string, code: string) {
  const from = process.env.SES_FROM;
  if (!from) {
    throw new Error("SES_FROM not configured");
  }
  const subject = "MaxHacker verification code";
  const logoUrl =
    process.env.SES_LOGO_URL ||
    "https://maxhacker.io/wp-content/uploads/2025/02/icononly_transparent_nobuffer-2-1.png";

  const codeCells = code
    .split("")
    .map(
      (char) =>
        `<td style="background:#eef2fb;border-radius:10px;padding:18px 22px;font-size:34px;font-weight:700;color:#0a58ff;font-family: 'Fira Code','Segoe UI',monospace;letter-spacing:4px;">${
          char || ""
        }</td>`
    )
    .join("");

  const bodyHtml = `
  <div style="margin:0;padding:28px;background:#f3f6fd;font-family:'Segoe UI',Helvetica,Arial,sans-serif;color:#1b2540;">
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:540px;margin:0 auto;background:#ffffff;border-radius:16px;box-shadow:0 8px 24px rgba(20,27,55,0.08);overflow:hidden;">
      <tr>
        <td style="padding:32px 40px 0;text-align:center;">
          <img src="${logoUrl}" alt="MaxHacker" style="width:72px;height:72px;border-radius:50%;border:1px solid #e3e8f8;object-fit:contain;" />
        </td>
      </tr>
      <tr>
        <td style="padding:36px 40px 24px;font-size:22px;font-weight:600;">Hi there,</td>
      </tr>
      <tr>
        <td style="padding:0 40px 16px;font-size:17px;line-height:1.6;">
          Your one-time verification code is below. It expires in <strong>5 minutes</strong>.
        </td>
      </tr>
      <tr>
        <td style="padding:24px 32px 12px;">
          <table role="presentation" cellpadding="0" cellspacing="14" align="center" style="margin:0 auto;">
            <tr>${codeCells}</tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:0 40px 36px;font-size:15px;line-height:1.6;color:#4b5565;">
          If you did not request this code, you can safely ignore this email.
          <br /><br />
          — MaxHacker IT Team
        </td>
      </tr>
    </table>
  </div>
  `;

  const bodyText = `Your MaxHacker verification code is ${code}. It expires in 5 minutes. If you didn't request it, ignore this email. -- MaxHacker IT Team`;

  if (!smtpTransporter) {
    throw new Error(
      "SMTP configuration missing: please set SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS"
    );
  }

  try {
    console.info("[SES] sendVerificationEmail attempt", {
      to: maskEmail(to),
      from: maskEmail(from),
      method: "smtp",
      host: smtpHost,
    });

    const info = await smtpTransporter.sendMail({
      from: {
        name: "MaxHacker IT Team",
        address: from,
      },
      to,
      subject,
      text: bodyText,
      html: bodyHtml,
    });

    console.info("[SES] sendVerificationEmail success", {
      to: maskEmail(to),
      method: "smtp",
      messageId: (info as any)?.messageId,
      response: (info as any)?.response,
    });

    return info;
  } catch (err: any) {
    console.error("[SES] sendVerificationEmail error", {
      to: maskEmail(to),
      method: "smtp",
      errorMessage: err?.message ?? String(err),
    });
    throw err;
  }
}

/**
 * Send welcome email to new Employee with login credentials and admin URL
 */
export async function sendEmployeeWelcomeEmail(
  to: string,
  username: string,
  password: string,
  retryCount: number = 0
): Promise<any> {
  const from = process.env.SES_FROM;
  if (!from) {
    throw new Error("SES_FROM not configured");
  }

  const subject = "Welcome to MaxHacker - Your Employee Account Details";
  const adminUrl = "https://showcase.maxhacker.io/adminmanagement";
  const logoUrl =
    process.env.SES_LOGO_URL ||
    "https://maxhacker.io/wp-content/uploads/2025/02/icononly_transparent_nobuffer-2-1.png";

  const bodyHtml = `
  <div style="margin:0;padding:28px;background:#f3f6fd;font-family:'Segoe UI',Helvetica,Arial,sans-serif;color:#1b2540;">
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:540px;margin:0 auto;background:#ffffff;border-radius:16px;box-shadow:0 8px 24px rgba(20,27,55,0.08);overflow:hidden;">
      <tr>
        <td style="padding:32px 40px 0;text-align:center;">
          <img src="${logoUrl}" alt="MaxHacker" style="width:72px;height:72px;border-radius:50%;border:1px solid #e3e8f8;object-fit:contain;" />
        </td>
      </tr>
      <tr>
        <td style="padding:36px 40px 24px;font-size:22px;font-weight:600;">Welcome to MaxHacker!</td>
      </tr>
      <tr>
        <td style="padding:0 40px 16px;font-size:17px;line-height:1.6;">
          Your Employee account has been successfully created. Below are your login credentials:
        </td>
      </tr>
      <tr>
        <td style="padding:16px 40px;">
          <div style="background:#f8fafc;border-radius:12px;padding:24px;margin:8px 0;">
            <div style="margin-bottom:16px;">
              <strong style="color:#374151;font-size:15px;">Username:</strong>
              <div style="font-family:'Fira Code',monospace;background:#ffffff;border:1px solid #e5e7eb;border-radius:6px;padding:12px;margin-top:6px;font-size:16px;color:#1f2937;">${username}</div>
            </div>
            <div style="margin-bottom:16px;">
              <strong style="color:#374151;font-size:15px;">Password:</strong>
              <div style="font-family:'Fira Code',monospace;background:#ffffff;border:1px solid #e5e7eb;border-radius:6px;padding:12px;margin-top:6px;font-size:16px;color:#1f2937;">${password}</div>
            </div>
            <div>
              <strong style="color:#374151;font-size:15px;">Admin Portal:</strong>
              <div style="margin-top:6px;">
                <a href="${adminUrl}" style="color:#0a58ff;text-decoration:none;font-weight:500;">${adminUrl}</a>
              </div>
            </div>
          </div>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 40px;">
          <div style="background:#f0f9ff;border-left:4px solid #0ea5e9;padding:16px;border-radius:8px;">
            <p style="margin:0;font-size:15px;color:#0369a1;font-weight:500;">🔐 Security Reminder</p>
            <p style="margin:8px 0 0;font-size:14px;color:#0284c7;line-height:1.5;">
              Please change your password after your first login and keep your credentials secure.
            </p>
          </div>
        </td>
      </tr>
      <tr>
        <td style="padding:0 40px 36px;font-size:15px;line-height:1.6;color:#4b5565;">
          If you have any questions or need assistance, please contact our IT team.
          <br /><br />
          — MaxHacker IT Team
        </td>
      </tr>
    </table>
  </div>
  `;

  const bodyText = `Welcome to MaxHacker!

Your Employee account has been created with the following credentials:

Username: ${username}
Password: ${password}
Admin Portal: ${adminUrl}

Please change your password after your first login and keep your credentials secure.

If you have any questions, contact our IT team.

-- MaxHacker IT Team`;

  if (!smtpTransporter) {
    throw new Error(
      "SMTP configuration missing: please set SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS"
    );
  }

  try {

    const info = await smtpTransporter.sendMail({
      from: {
        name: "MaxHacker IT Team",
        address: from,
      },
      to,
      subject,
      text: bodyText,
      html: bodyHtml,
    });


    return info;
  } catch (err: any) {
    console.error("[SES] sendEmployeeWelcomeEmail error", {
      to: maskEmail(to),
      username,
      method: "smtp",
      errorMessage: err?.message ?? String(err),
      retryCount,
    });

    // Retry logic - only retry once
    if (retryCount === 0) {
      try {
        return await sendEmployeeWelcomeEmail(to, username, password, 1);
      } catch (retryErr: any) {
        throw retryErr;
      }
    }

    throw err;
  }
}
