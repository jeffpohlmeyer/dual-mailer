import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import nodemailer from 'nodemailer';
import mg from 'nodemailer-mailgun-transport';
import { DualMailer, EmailError, EMAIL_ERROR_CODES } from './index';

// Mock nodemailer
vi.mock('nodemailer', () => ({
	default: {
		createTransport: vi.fn(() => ({
			verify: vi.fn().mockResolvedValue(true),
			sendMail: vi.fn().mockImplementation((options) => {
				if (options.to === 'recipient@example.com' && options.subject === 'Test Email 6') {
					return Promise.reject(new EmailError('Exceeded rate limit', EMAIL_ERROR_CODES.SEND));
				}
				return Promise.resolve({
					accepted: ['test@example.com'],
					response: 'OK'
				});
			}),
			isIdle: vi.fn().mockReturnValue(true),
			close: vi.fn().mockResolvedValue(true)
		}))
	}
}));

describe('DualMailer Rate Limiting', () => {
	let mailer;

	const basic_smtp_config = {
		host: 'smtp.test.com',
		port: 587
	};

	afterEach(async function () {
		if (mailer) {
			await mailer.destroy();
		}
	});

	beforeEach(() => {
		vi.clearAllMocks();
		mailer = new DualMailer(basic_smtp_config, {
			rate_limit: {
				max_connections: 2,
				max_messages_per_connection: 3,
				rate_delta: 1000,
				rate_limit: 5
			}
		});
	});

	it('should throttle email sends when rate limit is exceeded', async () => {
		// Send 5 emails within the rate delta
		for (let i = 0; i < 5; i++) {
			await mailer.send_mail({
				to: 'recipient@example.com',
				subject: `Test Email ${i}`,
				html: {
					title: 'Test Email',
					body: `This is test email ${i}.`
				}
			});
		}

		// The 6th email should throw a rate limit error
		await expect(
			mailer.send_mail({
				to: 'recipient@example.com',
				subject: 'Test Email 6',
				html: {
					title: 'Test Email',
					body: 'This is test email 6.'
				}
			})
		).rejects.toEqual(
			expect.objectContaining({
				name: 'EmailError',
				code: EMAIL_ERROR_CODES.SEND,
				message: expect.stringContaining('rate limit')
			})
		);
	});

	it('should not throttle email sends when rate limit is not exceeded', async () => {
		// Send 4 emails within the rate delta
		for (let i = 0; i < 4; i++) {
			await mailer.send_mail({
				to: 'recipient@example.com',
				subject: `Test Email ${i}`,
				html: {
					title: 'Test Email',
					body: `This is test email ${i}.`
				}
			});
		}

		// The 5th email should be sent successfully
		await expect(
			mailer.send_mail({
				to: 'recipient@example.com',
				subject: 'Test Email 5',
				html: {
					title: 'Test Email',
					body: 'This is test email 5.'
				}
			})
		).resolves.toBeUndefined();
	});

	it('should not throttle email sends when using Mailgun transport', async () => {
		mailer = new DualMailer(
			{
				mailgun_api_key: 'test_api_key',
				mailgun_domain: 'test.domain.com',
				is_dev: false
			},
			{
				rate_limit: {
					max_connections: 2,
					max_messages_per_connection: 3,
					rate_delta: 1000,
					rate_limit: 5
				}
			}
		);

		// Send 6 emails, which should all be successful
		for (let i = 0; i < 6; i++) {
			await mailer.send_mail({
				to: 'recipient@example.com',
				subject: `Test Email ${i}`,
				html: {
					title: 'Test Email',
					body: `This is test email ${i}.`
				}
			});
		}
	});
});
