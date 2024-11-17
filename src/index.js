import nodemailer from 'nodemailer';
import mg from 'nodemailer-mailgun-transport';

/**
 * @typedef {Object} MailConfig
 * @property {string} [mailgun_api_key] - Optional Mailgun API key
 * @property {string} [mailgun_domain] - Optional Mailgun domain
 * @property {string} [host] - Optional SMTP host
 * @property {number} [port] - Optional SMTP port
 * @property {string} [user] - Optional SMTP user
 * @property {string} [password] - Optional SMTP password
 * @property {string} [noreply_email] - Optional default from address
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
 * @property {string} [from]
 * @property {EmailHtmlType} html
 * @property {string} [reply_to]
 */

/**
 * @typedef {Object} RetryConfig
 * @property {number} [maxRetries=3] - Maximum number of retry attempts
 * @property {number} [retryDelay=1000] - Initial delay between retries in ms (doubles each retry)
 * @property {string[]} [retryableErrors=[]] - List of error messages to retry on (empty means retry all)
 */

/**
 * @typedef {Object} MailerOptions
 * @property {Function} [logger] - Custom logging function (level, message, meta) => void
 * @property {boolean} [silent] - Disable all logging if true
 * @property {RetryConfig} [retry] - Retry configuration
 */

/**
 * Custom error class for email-related errors
 */
export class EmailError extends Error {
	constructor(message, code, originalError = null) {
		super(message);
		this.name = 'EmailError';
		this.code = code;
		this.originalError = originalError;
	}
}

/**
 * Error codes for common email issues
 */
export const EMAIL_ERROR_CODES = {
	CONFIGURATION: 'EMAIL_CONFIG_ERROR',
	TRANSPORT: 'EMAIL_TRANSPORT_ERROR',
	VALIDATION: 'EMAIL_VALIDATION_ERROR',
	SEND: 'EMAIL_SEND_ERROR',
	CONNECTION: 'EMAIL_CONNECTION_ERROR'
};

export class DualMailer {
	/** @type {Map<string, any>} */
	#transporter_cache;
	#config;
	#max_transporter_age = 1000 * 60 * 30; // 30 minutes
	#max_emails_per_transporter = 1000;
	#max_consecutive_failures = 3;
	#cleanup_interval;
	#cleanup_interval_ms = 1000 * 60 * 5; // 5 minutes
	#max_idle_time = 1000 * 60 * 15; // 15 minutes
	#verify_timeout = 5000; // 5 seconds
	#logger;
	#retry;
	#retry_enabled;

	/**
	 * @param {MailConfig} config
	 * @param {MailerOptions} [options]
	 */
	constructor(config, options = {}) {
		try {
			this.#validate_config(config);
			this.#config = config;
			this.#transporter_cache = new Map();

			if (options.silent) {
				this.#logger = () => {}; // No-op logger
			} else if (options.logger) {
				this.#logger = options.logger;
			} else {
				this.#logger = this.#default_logger;
			}

			this.#retry = options.retry ?? {
				max_retries: 3,
				retry_delay: 1000,
				retryable_errors: []
			};

			// Retries are disabled by default, enable them if options.retry is provided
			this.#retry_enabled = Boolean(options.retry);

			// Start cleanup if not in dev mode
			if (!config.is_dev) {
				this.#cleanup_interval = this.#start_cleanup_interval();
			}
		} catch (error) {
			throw new EmailError(
				`Configuration error: ${error.message}`,
				EMAIL_ERROR_CODES.CONFIGURATION,
				error
			);
		}
	}

	/**
	 * Default logging implementation
	 * @param {string} level - Log level (info, warn, error)
	 * @param {string} message - Log message
	 * @param {Object} [meta] - Additional metadata
	 */
	#default_logger(level, message, meta = {}) {
		const timestamp = new Date().toISOString();
		const transport = this.#config.host ? 'SMTP' : 'Mailgun';

		// Don't log sensitive information
		const safe_meta = { ...meta };
		if (safe_meta.config) {
			delete safe_meta.config.password;
			delete safe_meta.config.mailgun_api_key;
		}

		console[level]({ timestamp, level, transport, message, ...safe_meta });
	}

	/**
	 * @param {MailConfig} config
	 * @throws {Error} If configuration is invalid
	 */
	#validate_config(config) {
		try {
			const has_smtp = Boolean(config.host && config.port);
			const has_mailgun = Boolean(config.mailgun_api_key && config.mailgun_domain);

			// Must have either SMTP or Mailgun config
			if (!has_smtp && !has_mailgun) {
				throw new Error(
					'Must provide either SMTP (host + port) or Mailgun (api_key + domain) configuration'
				);
			}

			// If SMTP host/port provided, they must both be present
			if (config.host && !config.port)
				throw new Error('SMTP port is required when host is provided');
			if (config.port && !config.host)
				throw new Error('SMTP host is required when port is provided');

			// If Mailgun config provided, both api_key and domain must be present
			if (config.mailgun_api_key && !config.mailgun_domain) {
				throw new Error('Mailgun domain is required when api_key is provided');
			}
			if (config.mailgun_domain && !config.mailgun_api_key) {
				throw new Error('Mailgun API key is required when domain is provided');
			}

			// If SMTP auth is partially configured, ensure both parts are present
			if (config.user && !config.password) {
				throw new Error('SMTP password is required when user is provided');
			}
			if (config.password && !config.user) {
				throw new Error('SMTP user is required when password is provided');
			}
		} catch (error) {
			throw new EmailError(error.message, EMAIL_ERROR_CODES.VALIDATION, error);
		}
	}

	/**
	 * Validate email payload
	 * @param {EmailDataType} payload - Email data
	 * @throws {EmailError} If payload is invalid
	 */
	#validate_payload(payload) {
		const required_fields = ['to', 'subject', 'html'];
		const missing_fields = required_fields.filter((field) => !payload[field]);

		if (missing_fields.length > 0) {
			throw new EmailError(
				`Missing required fields: ${missing_fields.join(', ')}`,
				EMAIL_ERROR_CODES.VALIDATION
			);
		}

		if (!payload.html.title || !payload.html.body) {
			throw new EmailError('HTML email requires both title and body', EMAIL_ERROR_CODES.VALIDATION);
		}
	}

	/**
	 * @returns {Object} Transport configuration
	 */
	#get_transport_config() {
		try {
			// Prefer SMTP if configured
			if (this.#config.host && this.#config.port) {
				const config = {
					host: this.#config.host,
					port: this.#config.port,
					secure: !this.#config.is_dev
				};

				// Add auth if credentials are provided
				if (this.#config.user && this.#config.password) {
					config.auth = {
						user: this.#config.user,
						pass: this.#config.password
					};

					// Add pool settings for authenticated SMTP
					config.pool = true;
					config.maxConnections = 5;
					config.maxMessages = 200;
					config.rateDelta = 1000;
					config.rateLimit = 5;
				}

				return config;
			}

			// Fall back to Mailgun if configured
			if (this.#config.mailgun_api_key && this.#config.mailgun_domain) {
				return mg({
					auth: {
						api_key: this.#config.mailgun_api_key,
						domain: this.#config.mailgun_domain
					}
				});
			}

			// This shouldn't happen due to validation, but just in case
			throw new Error('No valid transport configuration found');
		} catch (error) {
			throw new EmailError(
				'Failed to create transport configuration',
				EMAIL_ERROR_CODES.TRANSPORT,
				error
			);
		}
	}

	/**
	 * Checks if a transporter should be refreshed based on various criteria
	 * @param {Object} info - Transporter info
	 * @returns {boolean}
	 */
	#should_refresh_transporter(info) {
		const now = Date.now();
		const age = now - info.created_at;
		const idle_time = now - info.last_used;

		const should_refresh =
			age > this.#max_transporter_age ||
			info.email_count > this.#max_emails_per_transporter ||
			idle_time > this.#max_idle_time ||
			!info.transporter.isIdle() ||
			info.consecutive_failures >= this.#max_consecutive_failures;

		if (should_refresh) {
			const reason = {
				age: age > this.#max_transporter_age,
				email_count: info.email_count > this.#max_emails_per_transporter,
				idle: idle_time > this.#max_idle_time,
				not_idle: !info.transporter.isIdle(),
				failures: info.consecutive_failures >= this.#max_consecutive_failures
			};

			this.#logger('info', 'Transporter refresh needed', { reason });
		}

		return should_refresh;
	}

	/**
	 * Safely closes a transporter with error handling
	 * @param {Object} info - Transporter info
	 * @returns {Promise<void>}
	 */
	async #close_transporter(info) {
		try {
			if (!info.closing) {
				info.closing = true;
				if (info.transporter?.close) {
					await Promise.race([
						info.transporter.close(),
						new Promise((_, reject) =>
							setTimeout(
								() =>
									reject(new EmailError('Transporter close timeout', EMAIL_ERROR_CODES.TRANSPORT)),
								5000
							)
						)
					]);
				}
			}
		} catch (error) {
			this.#logger('warn', 'Error closing transporter', {
				error: error.message,
				code: error instanceof EmailError ? error.code : EMAIL_ERROR_CODES.TRANSPORT
			});
		}
	}

	/**
	 * Gets or creates a transporter with comprehensive error handling
	 * @returns {Promise<any>}
	 * @throws {EmailError} If transporter creation or verification fails
	 */
	async #get_transporter() {
		const key = 'default';
		const existing = this.#transporter_cache.get(key);

		if (existing) {
			try {
				const verify_result = await Promise.race([
					existing.transporter.verify(),
					new Promise((_, reject) =>
						setTimeout(
							() =>
								reject(new EmailError('Transporter verify timeout', EMAIL_ERROR_CODES.CONNECTION)),
							this.#verify_timeout
						)
					)
				]);

				if (!verify_result) {
					throw new EmailError('Transporter verification failed', EMAIL_ERROR_CODES.CONNECTION);
				}

				if (this.#should_refresh_transporter(existing)) {
					await this.#close_transporter(existing);
					this.#transporter_cache.delete(key);
				} else {
					return existing.transporter;
				}
			} catch (error) {
				this.#logger('warn', 'Transporter verification failed', {
					error: error.message,
					code: error instanceof EmailError ? error.code : EMAIL_ERROR_CODES.CONNECTION
				});
				await this.#close_transporter(existing);
				this.#transporter_cache.delete(key);
			}
		}

		try {
			const config = this.#get_transport_config();
			const info = {
				transporter: nodemailer.createTransport(config),
				created_at: Date.now(),
				email_count: 0,
				last_used: Date.now(),
				consecutive_failures: 0,
				closing: false
			};

			// Verify new transporter
			await Promise.race([
				info.transporter.verify(),
				new Promise((_, reject) =>
					setTimeout(
						() =>
							reject(
								new EmailError('Initial transporter verify timeout', EMAIL_ERROR_CODES.CONNECTION)
							),
						this.#verify_timeout
					)
				)
			]);

			this.#transporter_cache.set(key, info);
			return info.transporter;
		} catch (error) {
			throw new EmailError(
				`Failed to create transporter: ${error.message}`,
				EMAIL_ERROR_CODES.TRANSPORT,
				error
			);
		}
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

	/**
	 * Updates transporter metrics after sending
	 * @param {boolean} success - Whether the send was successful
	 */
	#update_transporter_metrics(success) {
		const info = this.#transporter_cache.get('default');
		if (info) {
			info.email_count++;
			info.last_used = Date.now();

			if (success) {
				info.consecutive_failures = 0;
			} else {
				info.consecutive_failures = (info.consecutive_failures || 0) + 1;

				if (info.consecutive_failures >= this.#max_consecutive_failures) {
					this.#logger('warn', 'Transporter marked for refresh due to failures', {
						consecutive_failures: info.consecutive_failures
					});
				}
			}
		}
	}

	/**
	 * Starts the cleanup interval with error handling
	 * @returns {NodeJS.Timeout}
	 */
	#start_cleanup_interval() {
		return setInterval(async () => {
			const promises = [];

			for (const [key, info] of this.#transporter_cache.entries()) {
				if (this.#should_refresh_transporter(info)) {
					promises.push(
						this.#close_transporter(info)
							.then(() => this.#transporter_cache.delete(key))
							.catch((error) => {
								this.#logger('error', 'Cleanup error', {
									error: error.message,
									code: error instanceof EmailError ? error.code : EMAIL_ERROR_CODES.TRANSPORT
								});
							})
					);
				}
			}

			if (promises.length > 0) {
				try {
					await Promise.allSettled(promises);
				} catch (error) {
					this.#logger('error', 'Cleanup cycle error', {
						error: error.message,
						code: error instanceof EmailError ? error.code : EMAIL_ERROR_CODES.TRANSPORT
					});
				}
			}
		}, this.#cleanup_interval_ms);
	}

	/**
	 * Send an email with retry capability
	 * @param {EmailDataType} payload
	 */
	async send_mail(payload) {
		const start_time = Date.now();
		const transport_type = this.#config.host ? 'SMTP' : 'Mailgun';
		let attempt = 1;

		const should_retry = (error, attempt) => {
			if (!this.#retry_enabled) return false;
			if (attempt > (this.#retry.maxRetries ?? 3)) return false;
			if (!this.#retry.retryableErrors?.length) return true;
			return this.#retry.retryableErrors.some((msg) => error.message.includes(msg));
		};

		const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

		while (true) {
			try {
				this.#validate_payload(payload);

				const {
					to,
					from = this.#config.noreply_email
						? `No Reply <${this.#config.noreply_email}>`
						: undefined,
					subject,
					text,
					html: html_data,
					reply_to
				} = payload;

				const html = this.#create_html_email(html_data);
				const transporter = await this.#get_transporter();

				this.#logger('info', 'Sending email', {
					to,
					subject,
					transport: transport_type,
					attempt
				});

				try {
					await transporter.sendMail({ from, to, subject, text, html, reply_to });

					// Update metrics and log success
					const duration = Date.now() - start_time;
					this.#logger('info', 'Email sent successfully', {
						to,
						subject,
						transport: transport_type,
						duration_ms: duration,
						attempts: attempt
					});

					this.#update_transporter_metrics(true);
					return; // Success - exit the retry loop
				} catch (error) {
					// Update failure metrics
					this.#update_transporter_metrics(false);

					if (should_retry(error, attempt)) {
						const delay = (this.#retry.retryDelay ?? 1000) * Math.pow(2, attempt - 1);
						this.#logger('warn', 'Email send failed, retrying', {
							error: error.message,
							attempt,
							next_attempt_in_ms: delay,
							transport: transport_type
						});

						await sleep(delay);
						attempt++;
						continue;
					}

					if (this.#config.is_dev) {
						this.#logger('error', 'Failed to send email in dev mode', {
							error: error.message,
							content: text ?? html,
							transport: transport_type,
							attempts: attempt
						});
					}

					throw new EmailError(
						`Failed to send email after ${attempt} attempt(s): ${error.message}`,
						EMAIL_ERROR_CODES.SEND,
						error
					);
				}
			} catch (error) {
				const duration = Date.now() - start_time;
				this.#logger('error', 'Email error occurred', {
					error: error.message,
					code: error instanceof EmailError ? error.code : EMAIL_ERROR_CODES.SEND,
					transport: transport_type,
					duration_ms: duration,
					attempts: attempt,
					stack: error.stack
				});

				throw error instanceof EmailError
					? error
					: new EmailError(
							`Unexpected error sending email after ${attempt} attempt(s): ${error.message}`,
							EMAIL_ERROR_CODES.SEND,
							error
						);
			}
		}
	}

	/**
	 * Cleanly destroys the mailer instance with error handling
	 */
	async destroy() {
		if (this.#cleanup_interval) {
			clearInterval(this.#cleanup_interval);
		}

		const promises = [];
		for (const [key, info] of this.#transporter_cache.entries()) {
			promises.push(
				this.#close_transporter(info)
					.then(() => this.#transporter_cache.delete(key))
					.catch((error) => {
						this.#logger('error', 'Destroy cleanup error', {
							error: error.message,
							code: error instanceof EmailError ? error.code : EMAIL_ERROR_CODES.TRANSPORT
						});
					})
			);
		}

		if (promises.length > 0) {
			await Promise.allSettled(promises);
		}
	}
}
