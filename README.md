# Dual Mailer

A flexible email utility that supports both Mailgun and self-hosted SMTP servers with automatic transport management, rate limiting, and retry capabilities. Perfect for applications that need to send emails through different providers.

## Features

- 📧 Supports both Mailgun and self-hosted SMTP
- 🔄 Automatic transport pooling and management
- 🚀 Connection reuse and optimization
- ⏱️ Automatic cleanup of idle connections
- 🛡️ Rate limiting for authenticated SMTP connections
- 🧪 Development mode support
- ♻️ Automatic retries on failed email sends

## Installation

```bash
npm install @jvp/dual-mailer
```

## Usage

### Basic SMTP Setup (e.g., for Mailhog)

```javascript
import { DualMailer } from '@jvp/dual-mailer';

const mailer = new DualMailer({
  host: 'localhost',
  port: 1025,
  is_dev: true
});
```

### Authenticated SMTP Setup

```javascript
const mailer = new DualMailer({
  host: 'smtp.your-domain.com',
  port: 587,
  user: 'your-username',
  password: 'your-password',
  is_dev: process.env.NODE_ENV === 'development'
});
```

### Mailgun Setup

```javascript
const mailer = new DualMailer({
  mailgun_api_key: 'your-mailgun-key',
  mailgun_domain: 'your-domain.com',
  is_dev: process.env.NODE_ENV === 'development'
});
```

### Sending Emails

```javascript
await mailer.send_mail({
  to: 'recipient@example.com',
  subject: 'Hello World',
  html: {
    title: 'My Email',
    body: '<h1>Hello World</h1>'
  }
});
```

### Enabling Retries

To enable retries for email sends, you can pass a `retry` option when creating the `DualMailer` instance:

```javascript
const mailer = new DualMailer(config, {
  retry: {
    max_retries: 3,
    retry_delay: 1000,
    retryable_errors: ['Temporary Error']
  }
});
```

The `retry` option accepts the following properties:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `max_retries` | number | 3 | The maximum number of retry attempts |
| `retry_delay` | number | 1000 | The initial delay between retries in milliseconds (the delay doubles for each subsequent retry) |
| `retryable_errors` | string[] | `[]` | A list of error messages that should trigger a retry (if empty, all errors will be retried) |

By default, retries are disabled. To enable them, you need to provide the `retry` option when creating the `DualMailer` instance.

### Advanced HTML Emails

```javascript
await mailer.send_mail({
  to: 'recipient@example.com',
  subject: 'Styled Email',
  from: 'custom@yourdomain.com', // Optional
  reply_to: 'support@yourdomain.com', // Optional
  html: {
    title: 'Styled Email',
    style: `
      .header { color: blue; }
      .content { padding: 20px; }
    `,
    body: `
      <div class="header">
        <h1>Welcome!</h1>
      </div>
      <div class="content">
        <p>This is a styled email.</p>
      </div>
    `
  }
});
```

### Rate Limiting

Dual Mailer supports rate limiting for authenticated SMTP connections. You can configure the rate limiting options when creating the `DualMailer` instance:

```javascript
const mailer = new DualMailer(config, {
  rate_limit: {
    max_connections: 5,
    max_messages_per_connection: 200,
    rate_delta: 1000,
    rate_limit: 5
  }
});
```

The `rate_limit` option accepts the following properties:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `max_connections` | number | 5 | The maximum number of concurrent SMTP connections |
| `max_messages_per_connection` | number | 200 | The maximum number of messages per SMTP connection |
| `rate_delta` | number | 1000 | The time window for rate limiting in milliseconds |
| `rate_limit` | number | 5 | The maximum number of messages to send within the rate delta |

Rate limiting is only applied to authenticated SMTP connections. For Mailgun, rate limiting is handled by the Mailgun service.

### Cleanup

Make sure to clean up when shutting down your application:

```javascript
await mailer.destroy();
```

## Configuration Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `host` | string | No* | SMTP host |
| `port` | number | No* | SMTP port |
| `user` | string | No | SMTP username for authentication |
| `password` | string | No** | SMTP password for authentication |
| `mailgun_api_key` | string | No*** | Mailgun API key |
| `mailgun_domain` | string | No*** | Mailgun domain |
| `noreply_email` | string | No | Default from address |
| `is_dev` | boolean | No | Development mode flag |

\* Required if using SMTP transport (must provide both host and port)  
\*\* Required if SMTP user is provided  
\*\*\* Required if using Mailgun transport (must provide both api_key and domain)

You must provide either:
- SMTP configuration (host + port), or
- Mailgun configuration (api_key + domain)

## Email Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `to` | string | Yes | Recipient email address |
| `subject` | string | Yes | Email subject |
| `text` | string | No | Plain text version |
| `from` | string | No | Sender address |
| `html` | object | Yes | HTML email content |
| `reply_to` | string | No | Reply-to address |

### HTML Object Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `title` | string | Yes | Email title |
| `style` | string | No | CSS styles |
| `body` | string | Yes | HTML content |

## Logging Options

The mailer accepts an optional logger in its constructor options. You can provide your own logging implementation or disable logging entirely.

### Using Custom Logger

```javascript
// With Winston
import winston from 'winston';
const logger = winston.createLogger({
  transports: [new winston.transports.Console()]
});

const mailer = new DualMailer(config, {
  logger: (level, message, meta) => logger.log(level, message, meta)
});

// With Pino
import pino from 'pino';
const logger = pino();

const mailer = new DualMailer(config, {
  logger: (level, message, meta) => logger[level]({ msg: message, ...meta })
});

// With custom logging service
const mailer = new DualMailer(config, {
  logger: (level, message, meta) => {
    MyLoggingService.log({
      severity: level,
      message,
      timestamp: new Date(),
      ...meta
    });
  }
});
```

### Disabling Logging

```javascript
const mailer = new DualMailer(config, { silent: true });
```

The logger function receives:
- `level`: 'info' | 'warn' | 'error'
- `message`: String description of the event
- `meta`: Object with additional context (timestamps, email details, errors)

## Development Mode

When `is_dev` is true:
- SSL is disabled for SMTP
- Failed emails log their content instead of throwing
- Transport cleanup is disabled

## Error Handling

```javascript
try {
  await mailer.send_mail({
    to: 'recipient@example.com',
    subject: 'Test Email',
    html: {
      title: 'Test',
      body: '<h1>Hello</h1>'
    }
  });
} catch (error) {
  console.error('Failed to send email:', error);
}
```

## Best Practices

1. Always call `destroy()` when shutting down your application
2. Use environment variables for sensitive configuration
3. Implement proper error handling
4. Set appropriate timeouts for your use case
5. For local development, use tools like Mailhog with simple SMTP configuration
6. Use authenticated SMTP or Mailgun for production environments
7. Configure appropriate rate limiting settings for your use case

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
