import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DualMailer } from './index.js';
import nodemailer from 'nodemailer';
import mg from 'nodemailer-mailgun-transport';

// Mock nodemailer
vi.mock('nodemailer', () => ({
	default: {
		createTransport: vi.fn(() => ({
			verify: vi.fn().mockResolvedValue(true),
			sendMail: vi.fn().mockResolvedValue({
				accepted: ['test@example.com'],
				response: 'OK'
			}),
			isIdle: vi.fn().mockReturnValue(true),
			close: vi.fn().mockResolvedValue(true)
		}))
	}
}));

// Mock mailgun transport
vi.mock('nodemailer-mailgun-transport', () => {
	return {
		default: vi.fn((config) => ({
			name: 'mailgun',
			version: '1.0.0',
			...config
		}))
	};
});

describe('DualMailer', () => {
	let mailer;

	// Different configuration scenarios
	const mailgun_config = {
		mailgun_api_key: 'test-key',
		mailgun_domain: 'test.com'
	};

	const basic_smtp_config = {
		host: 'smtp.test.com',
		port: 587
	};

	const authenticated_smtp_config = {
		...basic_smtp_config,
		user: 'test-user',
		password: 'test-password'
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(async () => {
		if (mailer) {
			await mailer.destroy();
		}
	});

	describe('Constructor', () => {
		it('should create instance with Mailgun config', () => {
			mailer = new DualMailer(mailgun_config);
			expect(mailer).toBeInstanceOf(DualMailer);
		});

		it('should create instance with basic SMTP config', () => {
			mailer = new DualMailer(basic_smtp_config);
			expect(mailer).toBeInstanceOf(DualMailer);
		});

		it('should create instance with authenticated SMTP config', () => {
			mailer = new DualMailer(authenticated_smtp_config);
			expect(mailer).toBeInstanceOf(DualMailer);
		});

		it('should throw without any valid transport config', () => {
			expect(() => new DualMailer({})).toThrow(
				'Must provide either SMTP (host + port) or Mailgun (api_key + domain) configuration'
			);
		});

		it('should validate complete configurations', () => {
			// Valid Mailgun
			expect(() => new DualMailer(mailgun_config)).not.toThrow();

			// Valid SMTP
			expect(() => new DualMailer(basic_smtp_config)).not.toThrow();

			// Valid authenticated SMTP
			expect(() => new DualMailer(authenticated_smtp_config)).not.toThrow();

			// Invalid - neither complete config
			expect(() => new DualMailer({ host: 'test.com' })).toThrow(
				'Must provide either SMTP (host + port) or Mailgun (api_key + domain) configuration'
			);

			expect(() => new DualMailer({ mailgun_api_key: 'key' })).toThrow(
				'Must provide either SMTP (host + port) or Mailgun (api_key + domain) configuration'
			);
		});

		it('should throw with SMTP auth password but no user', () => {
			expect(
				() =>
					new DualMailer({
						...basic_smtp_config,
						password: 'test-pass'
					})
			).toThrow('SMTP user is required when password is provided');
		});

		it('should throw with SMTP auth user but no password', () => {
			expect(
				() =>
					new DualMailer({
						...basic_smtp_config,
						user: 'test-user'
					})
			).toThrow('SMTP password is required when user is provided');
		});
	});

	describe('Mailgun Transport', () => {
		beforeEach(() => {
			mailer = new DualMailer(mailgun_config);
		});

		it('should send email using Mailgun transport', async () => {
			const email_data = {
				to: 'test@example.com',
				subject: 'Test',
				html: {
					title: 'Test',
					body: '<p>Test</p>'
				}
			};

			await mailer.send_mail(email_data);

			expect(mg).toHaveBeenCalledWith({
				auth: {
					api_key: mailgun_config.mailgun_api_key,
					domain: mailgun_config.mailgun_domain
				}
			});
		});
	});

	describe('SMTP Transport', () => {
		it('should send email using basic SMTP', async () => {
			mailer = new DualMailer(basic_smtp_config);

			const email_data = {
				to: 'test@example.com',
				subject: 'Test',
				html: {
					title: 'Test',
					body: '<p>Test</p>'
				}
			};

			await mailer.send_mail(email_data);

			expect(nodemailer.createTransport).toHaveBeenCalledWith(
				expect.objectContaining({
					host: basic_smtp_config.host,
					port: basic_smtp_config.port,
					secure: true // default when not in dev mode
				})
			);
		});

		it('should send email using authenticated SMTP', async () => {
			mailer = new DualMailer(authenticated_smtp_config);

			const email_data = {
				to: 'test@example.com',
				subject: 'Test',
				html: {
					title: 'Test',
					body: '<p>Test</p>'
				}
			};

			await mailer.send_mail(email_data);

			expect(nodemailer.createTransport).toHaveBeenCalledWith(
				expect.objectContaining({
					host: authenticated_smtp_config.host,
					port: authenticated_smtp_config.port,
					secure: true,
					auth: {
						user: authenticated_smtp_config.user,
						pass: authenticated_smtp_config.password
					}
				})
			);
		});
	});

	describe('Transport Management', () => {
		beforeEach(() => {
			mailer = new DualMailer(basic_smtp_config);
		});

		it('should create new transporter after max emails per transporter', async () => {
			const email_data = {
				to: 'test@example.com',
				subject: 'Test',
				html: {
					title: 'Test',
					body: '<p>Test</p>'
				}
			};

			// Send initial email to create transporter
			await mailer.send_mail(email_data);

			// Reset the createTransport mock count
			nodemailer.createTransport.mockClear();

			// Send enough emails to trigger new transporter creation
			for (let i = 0; i < 1001; i++) {
				await mailer.send_mail(email_data);
			}

			// Should create a new transporter after exceeding limit
			expect(nodemailer.createTransport).toHaveBeenCalled();
		});
	});

	describe('Development Mode', () => {
		beforeEach(() => {
			mailer = new DualMailer({ ...basic_smtp_config, is_dev: true });
		});

		it('should not use SSL in dev mode', async () => {
			const email_data = {
				to: 'test@example.com',
				subject: 'Test',
				html: {
					title: 'Test',
					body: '<p>Test</p>'
				}
			};

			await mailer.send_mail(email_data);

			expect(nodemailer.createTransport).toHaveBeenCalledWith(
				expect.objectContaining({
					secure: false
				})
			);
		});

		it('should log failed emails in dev mode', async () => {
			const mock_send_mail = vi.fn().mockRejectedValueOnce(new Error('Send failed'));
			const mock_console = vi.spyOn(console, 'log');

			nodemailer.createTransport.mockImplementationOnce(() => ({
				verify: vi.fn().mockResolvedValue(true),
				sendMail: mock_send_mail,
				isIdle: vi.fn().mockReturnValue(true),
				close: vi.fn().mockResolvedValue(true)
			}));

			const email_data = {
				to: 'test@example.com',
				subject: 'Test',
				html: {
					title: 'Test',
					body: '<p>Test</p>'
				}
			};

			await expect(() => mailer.send_mail(email_data)).rejects.toThrow();
			expect(mock_console).toHaveBeenCalledWith(
				'Sending mail failed. Here is the content:',
				expect.any(String)
			);
		});
	});

	describe('Cleanup', () => {
		it('should close all transporters on destroy', async () => {
			mailer = new DualMailer(basic_smtp_config);

			// Create a transporter
			await mailer.send_mail({
				to: 'test@example.com',
				subject: 'Test',
				html: { title: 'Test', body: '<p>Test</p>' }
			});

			await mailer.destroy();

			const transporter_instance = nodemailer.createTransport.mock.results[0].value;
			expect(transporter_instance.close).toHaveBeenCalled();
		});
	});
});
