// src/index.js
import nodemailer from 'nodemailer';
import mg from 'nodemailer-mailgun-transport';

/**
 * @typedef {Object} MailConfig
 * @property {string} mailgun_api_key - Mailgun API key
 * @property {string} mailgun_domain - Mailgun domain
 * @property {string} noreply_email - Default from address
 * @property {string} [host] - SMTP host for self-hosted email
 * @property {number} [port] - SMTP port
 * @property {string} [password] - SMTP password
 * @property {boolean} [is_dev] - Development mode flag
 */

/**
 * @typedef {Object} EmailHtmlType
 * @property {string} title
 * @property {string} [style]
 * @property {string} body
 */

/**
 * @typedef {Object} EmailDataType
 * @property {string} to
 * @property {string} subject
 * @property {string} [text]
 * @property {string} [user] - If provided, uses self-hosted SMTP
 * @property {string} [from]
 * @property {EmailHtmlType} html
 * @property {string} [reply_to]
 */

export class DualMailer {
  /** @type {Map<string, any>} */
  #transporter_cache;
  #config;
  #max_transporter_age = 1000 * 60 * 30; // 30 minutes
  #max_emails_per_transporter = 1000;
  #cleanup_interval;

  /**
   * @param {MailConfig} config
   */
  constructor(config) {
    this.#validate_config(config);
    this.#config = config;
    this.#transporter_cache = new Map();

    // Start cleanup if not in dev mode
    if (!config.is_dev) {
      this.#cleanup_interval = this.#start_cleanup_interval();
    }
  }

  /**
   * @param {MailConfig} config
   * @throws {Error} If required config is missing
   */
  #validate_config(config) {
    // Required for all modes
    if (!config.mailgun_api_key) throw new Error('Mailgun API key is required');
    if (!config.mailgun_domain) throw new Error('Mailgun domain is required');
    if (!config.noreply_email) throw new Error('Default noreply email is required');

    // Only validate SMTP config if any SMTP-specific config is provided
    const has_any_smtp_config = config.host || config.port || config.password;
    if (has_any_smtp_config) {
      if (!config.host) throw new Error('SMTP host is required when using SMTP configuration');
      if (!config.port) throw new Error('SMTP port is required when using SMTP configuration');
      if (!config.password) throw new Error('SMTP password is required when using SMTP configuration');
    }
  }

  /**
   * @param {string} [user]
   * @returns {Object} Transport configuration
   * @throws {Error} If SMTP config is missing when trying to use SMTP
   */
  #get_transport_config(user) {
    if (user) {
      // Verify SMTP config is available when trying to use user-specific email
      if (!this.#config.host || !this.#config.port || !this.#config.password) {
        throw new Error('SMTP configuration is required when using user-specific email sending');
      }

      return {
        host: this.#config.host,
        port: this.#config.port,
        secure: !this.#config.is_dev,
        auth: {
          user,
          pass: this.#config.password
        },
        pool: true,
        maxConnections: 5,
        maxMessages: 200,
        rateDelta: 1000,
        rateLimit: 5
      };
    }

    // In dev mode, use SMTP if configured, otherwise fall back to Mailgun
    if (this.#config.is_dev && this.#config.host && this.#config.port) {
      return {
        host: this.#config.host,
        port: this.#config.port
      };
    }

    // Default to Mailgun
    return mg({
      auth: {
        api_key: this.#config.mailgun_api_key,
        domain: this.#config.mailgun_domain
      }
    });
  }

  /**
   * @param {Object} info
   * @returns {boolean}
   */
  #should_refresh_transporter(info) {
    const now = Date.now();
    const age = now - info.created_at;
    const idle_time = now - info.last_used;

    return (
      age > this.#max_transporter_age ||
      info.email_count > this.#max_emails_per_transporter ||
      idle_time > 1000 * 60 * 15 ||
      !info.transporter.isIdle()
    );
  }

  /**
   * @param {Object} info
   */
  async #close_transporter(info) {
    try {
      if (info.transporter?.close) {
        await info.transporter.close();
      }
    } catch (error) {
      console.error('Error closing transporter:', error);
    }
  }

  /**
   * @param {string} [user]
   */
  async #get_transporter(user) {
    const key = user ?? 'default';
    const existing = this.#transporter_cache.get(key);

    if (existing) {
      try {
        await existing.transporter.verify();

        if (this.#should_refresh_transporter(existing)) {
          await this.#close_transporter(existing);
          this.#transporter_cache.delete(key);
        } else {
          return existing.transporter;
        }
      } catch (error) {
        await this.#close_transporter(existing);
        this.#transporter_cache.delete(key);
      }
    }

    const config = this.#get_transport_config(user);
    const info = {
      transporter: nodemailer.createTransport(config),
      created_at: Date.now(),
      email_count: 0,
      last_used: Date.now()
    };

    this.#transporter_cache.set(key, info);
    return info.transporter;
  }

  /**
   * @param {EmailHtmlType} html_data
   * @returns {string}
   */
  #create_html_email(html_data) {
    const { title, style, body } = html_data;
    return `<!doctype html>
      <html lang="en">
        <head>
          <title>${title}</title>
          <style>
            ${style ?? ''}
            body {font-family: sans-serif;}
          </style>
        </head>
        <body>
          ${body}     
        </body>
      </html>
    `;
  }

  #start_cleanup_interval() {
    return setInterval(() => {
      for (const [key, info] of this.#transporter_cache.entries()) {
        if (this.#should_refresh_transporter(info)) {
          this.#close_transporter(info).then(() => {
            this.#transporter_cache.delete(key);
          });
        }
      }
    }, 1000 * 60 * 5); // Every 5 minutes
  }

  /**
   * Send an email using either Mailgun or self-hosted SMTP
   * @param {EmailDataType} payload
   */
  async send_mail(payload) {
    const {
      to,
      from = `No Reply <${this.#config.noreply_email}>`,
      subject,
      text,
      user,
      html: html_data,
      reply_to
    } = payload;

    const html = this.#create_html_email(html_data);
    const transporter = await this.#get_transporter(user);

    try {
      if (this.#config.is_dev) {
        try {
          await transporter.sendMail({ from, to, subject, text, html, reply_to });
        } catch (error) {
          console.log('Sending mail failed. Here is the content:', text ?? html);
          throw error;
        }
      } else {
        await transporter.sendMail({ from, to, subject, text, html, reply_to });
      }

      // Update metrics
      const key = user ?? 'default';
      const info = this.#transporter_cache.get(key);
      if (info) {
        info.email_count++;
        info.last_used = Date.now();
      }
    } catch (error) {
      const key = user ?? 'default';
      const info = this.#transporter_cache.get(key);
      if (info) {
        info.email_count = this.#max_emails_per_transporter; // Force refresh on next use
      }
      throw error;
    }
  }

  /**
   * Close all transporters and cleanup
   */
  async destroy() {
    if (this.#cleanup_interval) {
      clearInterval(this.#cleanup_interval);
    }

    for (const [key, info] of this.#transporter_cache.entries()) {
      await this.#close_transporter(info);
      this.#transporter_cache.delete(key);
    }
  }
}