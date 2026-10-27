/** Shared UI building blocks (pagination, copy button, filters, toasts) and client-side errors. */
export default {
  dismissNotification: 'Dismiss notification',
  unexpectedError: 'An unexpected error occurred. Please try again.',
  infoAria: 'Info: {{ text }}',
  customEntry: 'Use "{{ value }}" as a custom entry',
  selectPlaceholder: 'Select...',
  selectedCount: '{{ count }} selected',
  pagination: {
    label: 'Pagination',
    showing: 'Showing {{ start }}–{{ end }} of {{ total }}',
    previousAria: 'Go to previous page',
    previous: 'Previous',
    nextAria: 'Go to next page',
    next: 'Next',
  },
  copy: {
    revealFirst: 'Reveal key first',
    disabled: 'Copy disabled',
    failed: 'Copy failed',
    toClipboard: 'Copy to clipboard',
  },
  filter: {
    all: 'All {{ noun }} ({{ count }})',
    some: '{{ selected }} of {{ total }} {{ noun }}',
    selectAll: 'Select all',
  },
  auth: {
    subscription: 'Subscription',
    local: 'Local',
    apiKey: 'API Key',
    subscriptionProvider: 'Subscription provider',
    apiKeyProvider: 'API key provider',
    localProvider: 'Local provider',
  },
  feedback: {
    title: 'Share feedback',
    details: 'Share details (optional)',
    submit: 'Submit',
    tags: {
      notExpectedTier: 'Not expected tier',
      poorQuality: 'Poor answer quality',
      tooSlow: 'Too slow',
      buggy: 'Buggy',
      other: 'Other',
    },
  },
  errors: {
    sessionExpired: 'Session expired',
    unauthorized: 'Unauthorized',
    apiError: 'API error: {{ status }} {{ statusText }}',
    requestFailed: 'Request failed ({{ status }})',
    streamNoResult: 'Stream ended without a result',
    bestAnswerFailed: 'Failed to set best answer',
    starFailed: 'Failed to toggle star',
    pollFailed: 'Poll failed: {{ status }}',
    setupFailed: 'Setup failed ({{ status }})',
  },
  analytics: {
    recoveredRequests: 'Successful requests that were recovered by fallback.',
    totalAttempts:
      'Every provider call counts here, including fallback retries. One request can produce several attempts.',
    modelSuccessRate: 'Successful attempts over all attempts for this model.',
    providerSuccessRate: 'Successful attempts over all attempts for this provider.',
    connectionSuccessRate30d:
      'Successful attempts over all attempts for this connection, over the last 30 days.',
    connectionSuccessRate:
      'Successful attempts over all attempts for this connection, on the filtered period.',
    connectionHarnessSuccessRate:
      'Successful attempts over all attempts for this harness on this connection.',
    harnessSuccessRate: 'Successful requests over all requests for this harness.',
    harnessTotalRequests:
      'Logical requests from this harness, one per call, whatever the number of attempts.',
    requestSuccessRate:
      'Successful requests over all requests. Recovered requests count as successful.',
  },
};
