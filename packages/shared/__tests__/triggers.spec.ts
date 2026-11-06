import {
  DEFAULT_SYSLOG_SEVERITIES,
  DEFAULT_TRIGGER_TEMPLATES,
  EMAIL_TRIGGER_PROVIDERS,
  HARNESS_TRIGGER_EVENTS,
  SYSLOG_FACILITIES,
  SYSLOG_FORMATS,
  SYSLOG_SEVERITIES,
  SYSLOG_TRANSPORTS,
  TRIGGER_EVENT_STATUSES,
  TRIGGER_EVENT_TYPES,
  TRIGGER_LIMITS,
  TRIGGER_TYPES,
  TRIGGER_VARIABLES,
  WEBHOOK_METHODS,
  WORKSPACE_TRIGGER_EVENTS,
} from '../src/triggers';

const unique = (values: readonly string[]) => new Set(values).size === values.length;

describe('trigger types and statuses', () => {
  it('lists the six delivery channels', () => {
    expect(TRIGGER_TYPES).toEqual(['email', 'webhook', 'telegram', 'syslog', 'gelf', 'relp']);
  });

  it('lists the delivery states of a queued event', () => {
    expect(TRIGGER_EVENT_STATUSES).toEqual(['pending', 'delivering', 'delivered', 'failed']);
  });

  it('lists the supported e-mail providers, webhook methods and syslog options', () => {
    expect(EMAIL_TRIGGER_PROVIDERS).toEqual(['resend', 'mailgun', 'sendgrid']);
    expect(WEBHOOK_METHODS).toEqual(['POST', 'PUT', 'PATCH', 'GET']);
    expect(SYSLOG_TRANSPORTS).toEqual(['udp', 'tcp']);
    expect(SYSLOG_FORMATS).toEqual(['rfc5424', 'rfc3164']);
  });
});

describe('trigger events', () => {
  it('has no duplicates inside or across the harness and workspace groups', () => {
    expect(unique(HARNESS_TRIGGER_EVENTS)).toBe(true);
    expect(unique(WORKSPACE_TRIGGER_EVENTS)).toBe(true);
    expect(unique(TRIGGER_EVENT_TYPES)).toBe(true);
  });

  it('keeps harness events and workspace events disjoint (they are routed differently)', () => {
    for (const event of WORKSPACE_TRIGGER_EVENTS) {
      expect(HARNESS_TRIGGER_EVENTS as readonly string[]).not.toContain(event);
    }
  });

  it('is the harness events, then the workspace events, then test', () => {
    expect(TRIGGER_EVENT_TYPES).toEqual([
      ...HARNESS_TRIGGER_EVENTS,
      ...WORKSPACE_TRIGGER_EVENTS,
      'test',
    ]);
  });

  it('binds only the five harness events and the two lifecycle events', () => {
    expect([...HARNESS_TRIGGER_EVENTS]).toEqual([
      'limit.alert',
      'limit.block',
      'provider.failure',
      'credential.expired',
      'request.debug',
    ]);
    expect([...WORKSPACE_TRIGGER_EVENTS]).toEqual(['harness.created', 'harness.deleted']);
  });
});

describe('syslog constants', () => {
  it('orders severities by RFC 5424 code', () => {
    expect(SYSLOG_SEVERITIES).toHaveLength(8);
    expect(SYSLOG_SEVERITIES[0]).toBe('emerg');
    expect(SYSLOG_SEVERITIES[3]).toBe('err');
    expect(SYSLOG_SEVERITIES[4]).toBe('warning');
    expect(SYSLOG_SEVERITIES[7]).toBe('debug');
  });

  it('orders facilities by RFC 5424 code', () => {
    expect(SYSLOG_FACILITIES).toHaveLength(24);
    expect(unique(SYSLOG_FACILITIES)).toBe(true);
    expect(SYSLOG_FACILITIES.indexOf('kern')).toBe(0);
    expect(SYSLOG_FACILITIES.indexOf('user')).toBe(1);
    expect(SYSLOG_FACILITIES.indexOf('authpriv')).toBe(10);
    expect(SYSLOG_FACILITIES.indexOf('local0')).toBe(16);
    expect(SYSLOG_FACILITIES.indexOf('local7')).toBe(23);
  });

  it('gives every event a default severity that is a real severity', () => {
    for (const event of TRIGGER_EVENT_TYPES) {
      expect(DEFAULT_SYSLOG_SEVERITIES).toHaveProperty([event]);
    }
    for (const severity of Object.values(DEFAULT_SYSLOG_SEVERITIES)) {
      expect(SYSLOG_SEVERITIES as readonly string[]).toContain(severity);
    }
  });

  it('has a separate, louder severity for a failed request.debug', () => {
    expect(DEFAULT_SYSLOG_SEVERITIES['request.debug']).toBe('info');
    expect(DEFAULT_SYSLOG_SEVERITIES['request.debug.failed']).toBe('err');
  });

  it('only keys known events (plus the failed request.debug variant)', () => {
    const allowed = new Set<string>([...TRIGGER_EVENT_TYPES, 'request.debug.failed']);
    for (const key of Object.keys(DEFAULT_SYSLOG_SEVERITIES)) expect(allowed.has(key)).toBe(true);
  });
});

describe('TRIGGER_LIMITS', () => {
  it.each(Object.entries(TRIGGER_LIMITS))('%s has a default inside its bounds', (_name, bounds) => {
    expect(Number.isInteger(bounds.min)).toBe(true);
    expect(Number.isInteger(bounds.max)).toBe(true);
    expect(bounds.min).toBeLessThanOrEqual(bounds.default);
    expect(bounds.default).toBeLessThanOrEqual(bounds.max);
  });

  it('allows a trigger with no retries but never a zero delay or timeout', () => {
    expect(TRIGGER_LIMITS.maxRetries.min).toBe(0);
    expect(TRIGGER_LIMITS.retryDelaySeconds.min).toBeGreaterThanOrEqual(1);
    expect(TRIGGER_LIMITS.timeoutSeconds.min).toBeGreaterThanOrEqual(1);
  });

  it('bounds delivery effort so one trigger cannot hold the queue for long', () => {
    expect(TRIGGER_LIMITS.maxRetries.max).toBe(10);
    expect(TRIGGER_LIMITS.timeoutSeconds.max).toBe(60);
    expect(TRIGGER_LIMITS.retryDelaySeconds.max).toBe(3600);
  });
});

describe('TRIGGER_VARIABLES', () => {
  const names = TRIGGER_VARIABLES.map((v) => v.name);

  it('declares every variable once', () => {
    expect(unique(names)).toBe(true);
  });

  it('uses dotted lowercase names the template engine can match', () => {
    for (const name of names) expect(name).toMatch(/^[a-z][a-z_]*(\.[a-z_]+)+$/);
  });

  it('restricts a variable only to known events', () => {
    for (const variable of TRIGGER_VARIABLES) {
      if (variable.events === 'all') continue;
      expect(variable.events.length).toBeGreaterThan(0);
      for (const event of variable.events) {
        expect(TRIGGER_EVENT_TYPES as readonly string[]).toContain(event);
      }
    }
  });

  it('offers the identity variables for every event', () => {
    const always = TRIGGER_VARIABLES.filter((v) => v.events === 'all').map((v) => v.name);
    expect(always).toEqual(
      expect.arrayContaining([
        'event.id',
        'event.type',
        'event.timestamp',
        'event.title',
        'event.message',
        'event.json',
        'workspace.id',
        'workspace.name',
        'trigger.name',
        'delivery.attempt',
        'harness.name',
        'harness.url',
      ]),
    );
  });

  it('exposes every event-specific family on the event that fills it', () => {
    const eventsOf = (name: string) => TRIGGER_VARIABLES.find((v) => v.name === name)!.events;
    expect(eventsOf('rule.threshold')).toEqual(['limit.alert', 'limit.block']);
    expect(eventsOf('period.reset')).toEqual(['limit.block']);
    expect(eventsOf('failure.count')).toEqual(['provider.failure']);
    expect(eventsOf('connection.id')).toEqual(['credential.expired']);
    expect(eventsOf('request.cost')).toEqual(['request.debug']);
    expect(eventsOf('actor.email')).toEqual(['harness.created', 'harness.deleted']);
  });

  it('covers every variable the default templates use', () => {
    const used = new Set<string>();
    const scan = (template: string) => {
      for (const match of template.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) used.add(match[1]!);
    };
    for (const group of Object.values(DEFAULT_TRIGGER_TEMPLATES)) {
      for (const value of Object.values(group)) scan(value);
    }
    expect(used.size).toBeGreaterThan(0);
    for (const name of used) expect(names).toContain(name);
  });
});

describe('DEFAULT_TRIGGER_TEMPLATES', () => {
  it('has a template for every trigger type', () => {
    expect(Object.keys(DEFAULT_TRIGGER_TEMPLATES).sort()).toEqual([...TRIGGER_TYPES].sort());
  });

  it('sends the whole event as JSON by default for webhooks', () => {
    expect(DEFAULT_TRIGGER_TEMPLATES.webhook).toEqual({
      body: '{{event.json}}',
      contentType: 'application/json',
    });
  });

  it('prefixes e-mail subjects with the product name', () => {
    expect(DEFAULT_TRIGGER_TEMPLATES.email.subject).toBe('[Thinker] {{event.title}}');
    expect(DEFAULT_TRIGGER_TEMPLATES.email.body).toContain('{{event.message}}');
  });

  it('puts the title and message in the telegram and syslog defaults', () => {
    expect(DEFAULT_TRIGGER_TEMPLATES.telegram.text).toContain('{{event.title}}');
    expect(DEFAULT_TRIGGER_TEMPLATES.telegram.text).toContain('{{event.message}}');
    expect(DEFAULT_TRIGGER_TEMPLATES.syslog.message).toBe('{{event.title}}: {{event.message}}');
  });
});
