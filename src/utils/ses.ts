import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const region = (process.env.SES_REGION ||
  process.env.AWS_REGION ||
  "ap-southeast-2") as string;
const client = new SESClient({ region });

export async function sendVerificationEmail(to: string, code: string) {
  const from = process.env.SES_FROM;
  const subject = "你的验证码";
  const bodyHtml = `<p>你的验证码是 <strong>${code}</strong>. 有效期 5 分钟。</p>`;
  const bodyText = `你的验证码是 ${code}. 有效期 5 分钟.`;

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
  return client.send(cmd);
}
