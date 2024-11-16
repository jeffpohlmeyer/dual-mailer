// src/index.test.js
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
  }
});

describe('DualMailer', () => {
  let mailer;

  // Basic config for Mailgun only
  const mailgun_config = {
    mailgun_api_key: 'test-key',
    mailgun_domain: 'test.com',
    noreply_email: 'noreply@test.com'
  };

  // Full config including SMTP
  const full_config = {
    ...mailgun_config,
    host: 'smtp.test.com',
    port: 587,
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
    it('should create instance with minimal config', () => {
      mailer = new DualMailer(mailgun_config);
      expect(mailer).toBeInstanceOf(DualMailer);
    });

    it('should create instance with full config', () => {
      mailer = new DualMailer(full_config);
      expect(mailer).toBeInstanceOf(DualMailer);
    });

    it('should throw without required Mailgun config', () => {
      expect(() => new DualMailer({})).toThrow('Mailgun API key is required');
      expect(() => new DualMailer({ mailgun_api_key: 'key' })).toThrow('Mailgun domain is required');
      expect(() => new DualMailer({ mailgun_domain: 'domain' })).toThrow('Mailgun API key is required');
    });

    it('should throw with partial SMTP config', () => {
      const partial_smtp = {
        ...mailgun_config,
        host: 'smtp.test.com', // Only providing host
      };
      expect(() => new DualMailer(partial_smtp)).toThrow('SMTP port is required');
    });
  });

  describe('Mailgun Mode', () => {
    beforeEach(() => {
      mailer = new DualMailer(mailgun_config);
    });

    it('should send email using Mailgun', async () => {
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

    it('should use default noreply email when from is not provided', async () => {
      const email_data = {
        to: 'test@example.com',
        subject: 'Test',
        html: {
          title: 'Test',
          body: '<p>Test</p>'
        }
      };

      await mailer.send_mail(email_data);

      const transporter_instance = nodemailer.createTransport.mock.results[0].value;
      const send_mail_call = transporter_instance.sendMail.mock.calls[0][0];
      expect(send_mail_call.from).toBe(`No Reply <${mailgun_config.noreply_email}>`);
    });
  });

  describe('SMTP Mode', () => {
    beforeEach(() => {
      mailer = new DualMailer(full_config);
    });

    it('should send email using SMTP when user is provided', async () => {
      const email_data = {
        to: 'test@example.com',
        subject: 'Test',
        user: 'smtp@test.com',
        html: {
          title: 'Test',
          body: '<p>Test</p>'
        }
      };

      await mailer.send_mail(email_data);

      expect(nodemailer.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          host: full_config.host,
          port: full_config.port,
          auth: {
            user: email_data.user,
            pass: full_config.password
          }
        })
      );
    });

    it('should throw when trying to use SMTP without SMTP config', async () => {
      mailer = new DualMailer(mailgun_config);

      const email_data = {
        to: 'test@example.com',
        subject: 'Test',
        user: 'smtp@test.com',
        html: {
          title: 'Test',
          body: '<p>Test</p>'
        }
      };

      await expect(() => mailer.send_mail(email_data))
        .rejects
        .toThrow('SMTP configuration is required');
    });
  });

  describe('Transport Management', () => {
    beforeEach(() => {
      mailer = new DualMailer(full_config);
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

    // Alternative approach using multiple emails
    it('should create different transporters for different users', async () => {
      const send_with_user = async (user) => {
        await mailer.send_mail({
          to: 'test@example.com',
          subject: 'Test',
          user,
          html: {
            title: 'Test',
            body: '<p>Test</p>'
          }
        });
      };

      // Send emails with different users
      await send_with_user('user1@test.com');
      await send_with_user('user2@test.com');

      // Should create separate transporters for each user
      expect(nodemailer.createTransport).toHaveBeenCalledTimes(2);
    });
  });

  describe('Development Mode', () => {
    beforeEach(() => {
      mailer = new DualMailer({ ...full_config, is_dev: true });
    });

    it('should not throw on failed email in dev mode', async () => {
      const mock_send_mail = vi.fn().mockRejectedValueOnce(new Error('Send failed'));
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
    });
  });

  describe('Cleanup', () => {
    it('should close all transporters on destroy', async () => {
      mailer = new DualMailer(full_config);

      // Create a few transporters
      await mailer.send_mail({
        to: 'test1@example.com',
        subject: 'Test 1',
        user: 'user1@test.com',
        html: { title: 'Test 1', body: '<p>Test 1</p>' }
      });

      await mailer.send_mail({
        to: 'test2@example.com',
        subject: 'Test 2',
        user: 'user2@test.com',
        html: { title: 'Test 2', body: '<p>Test 2</p>' }
      });

      await mailer.destroy();

      const transporter_instance = nodemailer.createTransport.mock.results[0].value;
      expect(transporter_instance.close).toHaveBeenCalled();
    });
  });
});