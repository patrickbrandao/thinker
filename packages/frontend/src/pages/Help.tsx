import type { Component } from 'solid-js';
import { Title, Meta } from '@solidjs/meta';
import { THINKER_DOCS_URL, THINKER_ISSUES_URL } from '../services/thinker-links.js';

const Help: Component = () => {
  return (
    <div class="container--sm">
      <Title>Help & Support - Thinker</Title>
      <Meta name="description" content="Get help with Thinker: documentation and issue tracker." />
      <div class="page-header">
        <div>
          <h1>Help & Support</h1>
          <span class="breadcrumb">
            Questions, bugs or ideas? Thinker is open source and tracked on GitHub
          </span>
        </div>
      </div>

      <div class="settings-card">
        <div class="settings-card__row">
          <div class="settings-card__label">
            <span class="settings-card__label-title">Documentation</span>
            <span class="settings-card__label-desc">
              Installation, configuration and provider guides.
            </span>
          </div>
          <div class="settings-card__control">
            <a
              href={THINKER_DOCS_URL}
              target="_blank"
              rel="noopener noreferrer"
              class="btn btn--outline btn--sm"
              style="text-decoration: none;"
            >
              Open docs
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                style="margin-left: 4px;"
                aria-hidden="true"
              >
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </a>
          </div>
        </div>
        <div class="settings-card__row">
          <div class="settings-card__label">
            <span class="settings-card__label-title">Issues</span>
            <span class="settings-card__label-desc">
              Report a bug or ask a question on GitHub. Leave out keys, tokens and request logs.
            </span>
          </div>
          <div class="settings-card__control">
            <a
              href={THINKER_ISSUES_URL}
              target="_blank"
              rel="noopener noreferrer"
              class="btn btn--outline btn--sm"
              style="text-decoration: none;"
            >
              Open issues
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                style="margin-left: 4px;"
                aria-hidden="true"
              >
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Help;
