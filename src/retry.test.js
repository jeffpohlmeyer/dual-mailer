import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DualMailer, EMAIL_ERROR_CODES } from './index.js';
import nodemailer from 'nodemailer';

// Mock nodemailer
vi.mock('nodemailer', () => ({
	default: {
		createTransport: vi.fn(() => ({
			verify: vi.fn().mockResolvedValue(true),
			sendMail: vi.fn(),
			isIdle: vi.fn().mockReturnValue(true),
			close: vi.fn().mockResolvedValue(true)
		}))
	}
}));

describe('DualMailer - Retry', function () {
	let mailer;

	const basic_smtp_config = {
		host: 'smtp.test.com',
		port: 587,
		noreply_email: 'noreply_test@example.com'
	};

	beforeEach(function () {
		vi.clearAllMocks();
	});

	afterEach(async function () {
		if (mailer) {
			await mailer.destroy();
		}
	});

	it('should retry email send on failure when retries are enabled', async function () {
		const mock_send_mail = vi.fn();
		let attempt_count = 0;

		// Mock the sendMail function to fail the first two attempts
		mock_send_mail
			.mockRejectedValueOnce(new Error('Temporary Error'))
			.mockRejectedValueOnce(new Error('Temporary Error'))
			.mockResolvedValueOnce({
				accepted: ['test@example.com'],
				response: 'OK'
			});

		nodemailer.createTransport.mockImplementationOnce(function () {
			return {
				verify: vi.fn().mockResolvedValue(true),
				sendMail: mock_send_mail,
				isIdle: vi.fn().mockReturnValue(true),
				close: vi.fn().mockResolvedValue(true)
			};
		});

		mailer = new DualMailer(basic_smtp_config, {
			retry: {
				max_retries: 3,
				retry_delay: 100,
				retryable_errors: ['Temporary Error']
			}
		});

		const email_data = {
			to: 'test@example.com',
			subject: 'Test',
			html: {
				title: 'Test',
				body: '<p>Test</p>'
			}
		};

		await mailer.send_mail(email_data);

		// Verify the sendMail function was called 3 times (2 retries + 1 success)
		expect(mock_send_mail).toHaveBeenCalledTimes(3);
	});

	it('should not retry on failure when retries are disabled', async function () {
		const mock_send_mail = vi.fn().mockRejectedValueOnce(new Error('Temporary Error'));

		nodemailer.createTransport.mockImplementationOnce(function () {
			return {
				verify: vi.fn().mockResolvedValue(true),
				sendMail: mock_send_mail,
				isIdle: vi.fn().mockReturnValue(true),
				close: vi.fn().mockResolvedValue(true)
			};
		});

		mailer = new DualMailer(basic_smtp_config);

		const email_data = {
			to: 'test@example.com',
			subject: 'Test',
			html: {
				title: 'Test',
				body: '<p>Test</p>'
			}
		};

		await expect(mailer.send_mail(email_data)).rejects.toThrowError(
			`Failed to send email after 1 attempt(s): Temporary Error`
		);

		expect(mock_send_mail).toHaveBeenCalledTimes(1);
	});

	it('should enable retries when retry option is provided', async function () {
		const mock_send_mail = vi.fn();
		mock_send_mail.mockRejectedValueOnce(new Error('Temporary Error')).mockResolvedValueOnce({
			accepted: ['test@example.com'],
			response: 'OK'
		});

		nodemailer.createTransport.mockImplementationOnce(function () {
			return {
				verify: vi.fn().mockResolvedValue(true),
				sendMail: mock_send_mail,
				isIdle: vi.fn().mockReturnValue(true),
				close: vi.fn().mockResolvedValue(true)
			};
		});

		mailer = new DualMailer(basic_smtp_config, {
			retry: {
				max_retries: 1,
				retry_delay: 100,
				retryable_errors: ['Temporary Error']
			}
		});

		const email_data = {
			to: 'test@example.com',
			subject: 'Test',
			html: {
				title: 'Test',
				body: '<p>Test</p>'
			}
		};

		await mailer.send_mail(email_data);

		expect(mock_send_mail).toHaveBeenCalledTimes(2);
	});
});
