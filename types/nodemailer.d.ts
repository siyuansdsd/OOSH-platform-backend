declare module "nodemailer" {
  export interface TransportAuth {
    user: string;
    pass: string;
  }

  export interface TransportOptions {
    host?: string;
    port?: number;
    secure?: boolean;
    auth?: TransportAuth;
  }

  export interface SentMessageInfo {
    messageId?: string;
    response?: string;
    [key: string]: unknown;
  }

  export interface Transporter {
    sendMail(mail: Record<string, unknown>): Promise<SentMessageInfo>;
  }

  export function createTransport(options: TransportOptions): Transporter;

  const nodemailer: {
    createTransport: typeof createTransport;
  };

  export default nodemailer;
}

