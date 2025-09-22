import nodemailer from "nodemailer";

const smtpHost = process.env.SMTP_HOST;
const smtpPort = process.env.SMTP_PORT
  ? Number(process.env.SMTP_PORT)
  : 587;
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
  const subject = "Your verification code";
  const bodyHtml = `<p>Your verification code is <strong>${code}</strong>. It is valid for 5 minutes.</p>`;
  const bodyText = `Your verification code is ${code}. It is valid for 5 minutes.`;

  if (!smtpTransporter) {
    throw new Error("SMTP configuration missing: please set SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS");
  }

  try {
    console.info("[SES] sendVerificationEmail attempt", {
      to: maskEmail(to),
      from: maskEmail(from),
      method: "smtp",
      host: smtpHost,
    });

    const info = await smtpTransporter.sendMail({
      from,
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
