export interface MailConfig {
	mailgun_api_key?: string;
	mailgun_domain?: string;
	host?: string;
	port?: number;
	user?: string;
	password?: string;
	noreply_email?: string;
	is_dev?: boolean;
}

export interface EmailHtmlType {
	title: string;
	style?: string;
	body: string;
}

export interface EmailDataType {
	to: string;
	subject: string;
	text?: string;
	from?: string;
	html: EmailHtmlType;
	reply_to?: string;
}

export interface RetryConfig {
	maxRetries?: number;
	retryDelay?: number;
	retryableErrors?: string[];
}

export interface RateLimitConfig {
	max_connections?: number;
	max_messages_per_connection?: number;
	rate_delta?: number;
	rate_limit?: number;
}

export interface MailerOptions {
	logger?: (level: string, message: string, meta?: Record<string, any>) => void;
	silent?: boolean;
	retry?: RetryConfig;
	rate_limit?: RateLimitConfig;
}

export class EmailError extends Error {
	code: string;
	originalError: Error | null;
	constructor(message: string, code: string, originalError?: Error | null);
}

export const EMAIL_ERROR_CODES: {
	CONFIGURATION: 'EMAIL_CONFIG_ERROR';
	TRANSPORT: 'EMAIL_TRANSPORT_ERROR';
	VALIDATION: 'EMAIL_VALIDATION_ERROR';
	SEND: 'EMAIL_SEND_ERROR';
	CONNECTION: 'EMAIL_CONNECTION_ERROR';
};

export class DualMailer {
	constructor(config: MailConfig, options?: MailerOptions);
	send_mail(payload: EmailDataType): Promise<void>;
	destroy(): Promise<void>;
}

// Augment nodemailer types
declare module 'nodemailer/lib/mailer' {
	interface Transporter {
		isIdle(): boolean;
	}
}
