import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const region = (process.env.SES_REGION ||
  process.env.AWS_REGION ||
  "ap-southeast-2") as string;
const client = new SESClient({ region });

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
  const subject = "Your verification code";
  const bodyHtml = `<p>Your verification code is <strong>${code}</strong>. It is valid for 5 minutes.</p>`;
  const bodyText = `Your verification code is ${code}. It is valid for 5 minutes.`;

  const params = {
    Destination: { ToAddresses: [to] },
    Message: {
      Body: {
        Html: { Data: bodyHtml },
        Text: { Data: bodyText },
      },
      Subject: { Data: subject },
    },
    Source: from,
  };

  const cmd = new SendEmailCommand(params);

  // 记录尝试（不输出完整邮箱/凭证）
  try {
    console.info("[SES] sendVerificationEmail attempt", {
      to: maskEmail(to),
      from: maskEmail(from),
      region,
      action: "sendVerificationEmail",
    });

    const resp = await client.send(cmd);

    // 成功日志，包含 MessageId（非敏感）
    console.info("[SES] sendVerificationEmail success", {
      to: maskEmail(to),
      messageId: (resp as any)?.MessageId,
    });

    return resp;
  } catch (err: any) {
    // 失败日志：记录简要错误信息与 SDK metadata 以便排查，但避免记录秘密
    console.error("[SES] sendVerificationEmail error", {
      to: maskEmail(to),
      errorMessage: err?.message ?? String(err),
      // $metadata 可能包含请求 id / status 等有用信息
      metadata: err?.$metadata
        ? {
            httpStatusCode: err.$metadata?.httpStatusCode,
            requestId: err.$metadata?.requestId,
          }
        : undefined,
    });
    throw err;
  }
}
