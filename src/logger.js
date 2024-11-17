// src/logger.js

import winston from 'winston';

/**
 * @typedef {Object} LogConfig
 * @property {string} [level] - Log level (default: 'info' for prod, 'debug' for dev)
 * @property {string} [filename] - Optional log file path
 * */
export function create_logger(is_dev, config = {}) {
	const logger = winston.createLogger({
		level: config.level || (is_dev ? 'debug' : 'info'),
		format: winston.format.combine(winston.format.timestamp(), winston.format.json())
	});

	// Always log to console with different formats for dev/prod
	logger.add(
		new winston.transports.Console({
			format: is_dev
				? winston.format.combine(winston.format.colorize(), winston.format.simple())
				: winston.format.json()
		})
	);

	// Optionally log to file in production
	if (!is_dev && config.filename) {
		logger.add(
			new winston.transports.File({
				filename: config.filename,
				level: 'info'
			})
		);
	}

	return logger;
}
