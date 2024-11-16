# Dual Mailer

A flexible email utility that supports both Mailgun and self-hosted SMTP servers with automatic transport management. Perfect for applications that need to send emails through different providers.

## Features

- 📧 Supports both Mailgun and self-hosted SMTP
- 🔄 Automatic transport pooling and management
- 🚀 Connection reuse and optimization
- ⏱️ Automatic cleanup of idle connections
- 🛡️ Rate limiting for SMTP connections
- 🧪 Development mode support

## Installation

```bash
npm install @jvp/dual-mailer
```

## Usage

### Mailgun Only Setup

```javascript
import { DualMailer } from '@jvp/dual-mailer';

const mailer = new DualMailer({
  // Required Mailgun config
  mailgun_api_key: 'your-mailgun-key',
  mailgun_domain: 'your-domain.com',
  noreply_email: 'noreply@your-domain.com',
  is_dev: process.env.NODE_ENV === 'development'
});
```

### Dual Mode Setup (Mailgun + SMTP)

```javascript
const mailer = new DualMailer({
  // Required Mailgun config
  mailgun_api_key: 'your-mailgun-key',
  mailgun_domain: 'your-domain.com',
  noreply_email: 'noreply@your-domain.com',
  
  // Optional SMTP config - required only if you plan to use SMTP
  host: 'smtp.your-domain.com',
  port: 587,
  password: 'your-smtp-password',
  
  is_dev: process.env.NODE_ENV === 'development'
});
```

### Sending via Mailgun (Default)

```javascript
await mailer.send_mail({
  to: 'recipient@example.com',
  subject: 'Hello from Mailgun',
  html: {
    title: 'My Email',
    body: '<h1>Hello World</h1>'
  }
});
```

### Sending via Self-hosted SMTP

```javascript
await mailer.send_mail({
  to: 'recipient@example.com',
  subject: 'Hello from SMTP',
  user: 'your-smtp-user@your-domain.com', // This triggers SMTP mode
  html: {
    title: 'My Email',
    body: '<h1>Hello World</h1>'
  }
});
```

### Advanced HTML Emails

```javascript
await mailer.send_mail({
  to: 'recipient@example.com',
  subject: 'Styled Email',
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

### Cleanup

Make sure to clean up when shutting down your application:

```javascript
await mailer.destroy();
```

## Configuration Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `mailgun_api_key` | string | Yes | Mailgun API key |
| `mailgun_domain` | string | Yes | Mailgun domain |
| `noreply_email` | string | Yes | Default from address |
| `host` | string | No* | SMTP host for self-hosted email |
| `port` | number | No* | SMTP port |
| `password` | string | No* | SMTP password |
| `is_dev` | boolean | No | Development mode flag |

\* Required only when using SMTP mode

## Email Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `to` | string | Yes | Recipient email address |
| `subject` | string | Yes | Email subject |
| `text` | string | No | Plain text version |
| `user` | string | No | SMTP user (triggers SMTP mode) |
| `from` | string | No | Sender address (defaults to noreply_email) |
| `html` | object | Yes | HTML email content |
| `reply_to` | string | No | Reply-to address |

### HTML Object Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `title` | string | Yes | Email title |
| `style` | string | No | CSS styles |
| `body` | string | Yes | HTML content |

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

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.