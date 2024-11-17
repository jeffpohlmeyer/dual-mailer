import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DualMailer, EmailError, EMAIL_ERROR_CODES } from './index.js';

vi.mock('nodemailer', () => ({
	default: {
		createTransport: vi.fn()
	}
}));

const nodemailer = vi.mocked(await import('nodemailer')).default;

describe('Transport Management', () => {
	let mailer;
	let mock_transporter;
	let mock_verify;
	let mock_send_mail;
	let mock_close;
	let mock_is_idle;
	const basic_config = {
		host: 'smtp.test.com',
		port: 587
	};

	beforeEach(() => {
		// Reset all mocks
		vi.clearAllMocks();
		vi.useFakeTimers();

		// Setup detailed mocks
		mock_verify = vi.fn().mockResolvedValue(true);
		mock_send_mail = vi.fn().mockResolvedValue({ response: 'OK' });
		mock_close = vi.fn().mockResolvedValue(true);
		mock_is_idle = vi.fn().mockReturnValue(true);

		mock_transporter = {
			verify: mock_verify,
			sendMail: mock_send_mail,
			close: mock_close,
			isIdle: mock_is_idle
		};

		nodemailer.createTransport = vi.fn().mockReturnValue(mock_transporter);
	});

	afterEach(async () => {
		if (mailer) {
			await mailer.destroy();
		}
		vi.useRealTimers();
	});

	describe('Transporter Lifecycle', () => {
		it('should create new transporter when none exists', async () => {
			mailer = new DualMailer(basic_config);

			await mailer.send_mail({
				to: 'test@example.com',
				subject: 'Test',
				html: { title: 'Test', body: 'Test' }
			});

			expect(nodemailer.createTransport).toHaveBeenCalledTimes(1);
			expect(mock_verify).toHaveBeenCalled();
		});

		it('should reuse existing transporter when available', async () => {
			mailer = new DualMailer(basic_config);

			// Send two emails
			await mailer.send_mail({
				to: 'test@example.com',
				subject: 'Test 1',
				html: { title: 'Test', body: 'Test' }
			});

			await mailer.send_mail({
				to: 'test@example.com',
				subject: 'Test 2',
				html: { title: 'Test', body: 'Test' }
			});

			expect(nodemailer.createTransport).toHaveBeenCalledTimes(1);
		});

		it('should refresh transporter after max age', async () => {
			mailer = new DualMailer(basic_config);

			// Send initial email
			await mailer.send_mail({
				to: 'test@example.com',
				subject: 'Test',
				html: { title: 'Test', body: 'Test' }
			});

			// Advance time past max age
			vi.advanceTimersByTime(1000 * 60 * 31); // 31 minutes

			// Send another email
			await mailer.send_mail({
				to: 'test@example.com',
				subject: 'Test',
				html: { title: 'Test', body: 'Test' }
			});

			expect(nodemailer.createTransport).toHaveBeenCalledTimes(2);
		});

		it('should handle verify timeout', async () => {
			// Advance timers first before sending email
			const mock_logger = vi.fn();
			mailer = new DualMailer(basic_config, {
				logger: mock_logger
			});

			// Mock verify to never resolve
			mock_verify.mockReturnValue(new Promise(() => {}));

			// Start advancing timers before sending email
			const timerPromise = vi.advanceTimersByTimeAsync(5001);

			// Send the email
			const emailPromise = mailer.send_mail({
				to: 'test@example.com',
				subject: 'Test',
				html: { title: 'Test', body: 'Test' }
			});

			// Wait for both the timer and the email promise
			await expect(Promise.race([emailPromise, timerPromise])).rejects.toThrow(
				'Failed to create transporter: Initial transporter verify timeout'
			);
		}, 10000);
	});

	describe('Error Handling', () => {
		it('should track consecutive failures', async () => {
			mailer = new DualMailer(basic_config);
			mock_send_mail.mockRejectedValue(new Error('Send failed'));

			const email_data = {
				to: 'test@example.com',
				subject: 'Test',
				html: { title: 'Test', body: 'Test' }
			};

			// Send multiple emails that fail
			for (let i = 0; i < 3; i++) {
				await expect(mailer.send_mail(email_data)).rejects.toThrow(EmailError);
			}

			// The next attempt should create a new transporter
			await expect(mailer.send_mail(email_data)).rejects.toThrow();
			expect(nodemailer.createTransport).toHaveBeenCalledTimes(2);
		});

		it('should reset failure count after successful send', async () => {
			mailer = new DualMailer(basic_config);

			const email_data = {
				to: 'test@example.com',
				subject: 'Test',
				html: { title: 'Test', body: 'Test' }
			};

			// Two failed sends
			mock_send_mail.mockRejectedValueOnce(new Error('Send failed'));
			mock_send_mail.mockRejectedValueOnce(new Error('Send failed'));

			await expect(mailer.send_mail(email_data)).rejects.toThrow(EmailError);
			await expect(mailer.send_mail(email_data)).rejects.toThrow(EmailError);

			// Successful send
			mock_send_mail.mockResolvedValueOnce({ response: 'OK' });
			await mailer.send_mail(email_data);

			// Should still use same transporter
			expect(nodemailer.createTransport).toHaveBeenCalledTimes(1);
		});

		it('should handle close timeout', async () => {
			mock_close.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						setTimeout(resolve, 6000); // Longer than timeout
					})
			);

			mailer = new DualMailer(basic_config);

			// Create a transporter
			await mailer.send_mail({
				to: 'test@example.com',
				subject: 'Test',
				html: { title: 'Test', body: 'Test' }
			});

			// Force a refresh
			vi.advanceTimersByTime(1000 * 60 * 31); // 31 minutes

			// This should trigger a close with timeout
			await mailer.send_mail({
				to: 'test@example.com',
				subject: 'Test',
				html: { title: 'Test', body: 'Test' }
			});

			expect(nodemailer.createTransport).toHaveBeenCalledTimes(2);
		});
	});

	describe('Cleanup', () => {
		it('should cleanup idle transporters', async () => {
			mailer = new DualMailer(basic_config);

			// Send an email
			await mailer.send_mail({
				to: 'test@example.com',
				subject: 'Test',
				html: { title: 'Test', body: 'Test' }
			});

			// Advance time past idle timeout
			vi.advanceTimersByTime(1000 * 60 * 16); // 16 minutes

			// Wait for next cleanup cycle
			vi.advanceTimersByTime(1000 * 60 * 5); // 5 minutes

			expect(mock_close).toHaveBeenCalled();
		});

		it('should cleanup all transporters on destroy', async () => {
			mailer = new DualMailer(basic_config);

			// Create a transporter
			await mailer.send_mail({
				to: 'test@example.com',
				subject: 'Test',
				html: { title: 'Test', body: 'Test' }
			});

			await mailer.destroy();

			expect(mock_close).toHaveBeenCalled();
		});
	});
});
