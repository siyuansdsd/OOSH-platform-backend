import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const region = (process.env.SES_REGION ||
  process.env.AWS_REGION ||
  "ap-southeast-2") as string;
const client = new SESClient({ region });

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
  return client.send(cmd);
}
