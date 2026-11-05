import type { SpecificityCategory } from 'thinker-shared';
import { DEFAULT_CONFIG } from './config';
import { KeywordTrie } from './keyword-trie';
import { DEFAULT_KEYWORDS } from './keywords';
import { CALENDAR_MANAGEMENT_KEYWORDS } from './keywords/calendar-management';
import { COMPLEXITY_KEYWORDS } from './keywords/complexity';
import { DATA_ANALYSIS_KEYWORDS } from './keywords/data-analysis';
import { EMAIL_MANAGEMENT_KEYWORDS } from './keywords/email-management';
import { IMAGE_GENERATION_KEYWORDS } from './keywords/image-generation';
import { SOCIAL_MEDIA_KEYWORDS } from './keywords/social-media';
import { TRADING_KEYWORDS } from './keywords/trading';
import { VIDEO_GENERATION_KEYWORDS } from './keywords/video-generation';
import { WEB_BROWSING_KEYWORDS } from './keywords/web-browsing';
import { scanMessages } from './scan-messages';
import { scoreRequest } from './index';
import { ACTIVATION_THRESHOLDS, weightFor } from './specificity-weights';

const SPECIFICITY_SETS: Record<string, string[]> = {
  webBrowsing: WEB_BROWSING_KEYWORDS,
  dataAnalysis: DATA_ANALYSIS_KEYWORDS,
  imageGeneration: IMAGE_GENERATION_KEYWORDS,
  videoGeneration: VIDEO_GENERATION_KEYWORDS,
  socialMedia: SOCIAL_MEDIA_KEYWORDS,
  emailManagement: EMAIL_MANAGEMENT_KEYWORDS,
  calendarManagement: CALENDAR_MANAGEMENT_KEYWORDS,
  trading: TRADING_KEYWORDS,
};

const COMPLEXITY_DIMENSIONS = [
  'formalLogic',
  'analyticalReasoning',
  'codeGeneration',
  'codeReview',
  'technicalTerms',
  'simpleIndicators',
  'multiStep',
  'creative',
  'questionComplexity',
  'imperativeVerbs',
  'outputFormat',
  'domainSpecificity',
  'agenticTasks',
  'relay',
];

function category(text: string): SpecificityCategory | null {
  return scanMessages([{ role: 'user', content: text }])?.category ?? null;
}

describe('DEFAULT_KEYWORDS aggregation', () => {
  it('contains every complexity dimension and every specificity set', () => {
    expect(Object.keys(DEFAULT_KEYWORDS).sort()).toEqual(
      [...COMPLEXITY_DIMENSIONS, ...Object.keys(SPECIFICITY_SETS)].sort(),
    );
  });

  it('exposes the same arrays as the per-category modules', () => {
    for (const [name, list] of Object.entries(SPECIFICITY_SETS)) {
      expect(DEFAULT_KEYWORDS[name]).toBe(list);
    }
    for (const [name, list] of Object.entries(COMPLEXITY_KEYWORDS)) {
      expect(DEFAULT_KEYWORDS[name]).toBe(list);
    }
  });

  it('feeds every set into the scorer config', () => {
    for (const name of Object.keys(DEFAULT_KEYWORDS)) {
      const dim = DEFAULT_CONFIG.dimensions.find((d) => d.name === name);
      expect(dim?.keywords).toBe(DEFAULT_KEYWORDS[name]);
    }
  });
});

describe('keyword set hygiene', () => {
  describe.each(Object.entries(DEFAULT_KEYWORDS))('%s', (_name, keywords) => {
    it('is non-empty', () => {
      expect(keywords.length).toBeGreaterThan(0);
    });

    it('has trimmed, non-empty, ASCII entries', () => {
      for (const keyword of keywords) {
        expect(keyword).toBe(keyword.trim());
        expect(keyword.length).toBeGreaterThan(0);
        // The trie only treats [0-9A-Za-z_] as word characters, so accented
        // keywords would never get a reliable word boundary.
        expect(keyword).toMatch(/^[\x20-\x7e]+$/);
      }
    });

    it('has no duplicates (case-insensitive)', () => {
      const lower = keywords.map((k) => k.toLowerCase());
      expect(lower.filter((k, i) => lower.indexOf(k) !== i)).toEqual([]);
    });

    it('matches every keyword it declares, in its own dimension', () => {
      const trie = new KeywordTrie([{ name: _name, keywords }]);
      for (const keyword of keywords) {
        const matches = trie.scan(`please ${keyword} now`);
        expect(matches.map((m) => m.keyword)).toContain(keyword.toLowerCase());
      }
    });
  });

  it('only shares keywords across specificity sets on purpose', () => {
    // A keyword listed in two specificity sets adds weight to both categories.
    // New overlaps must be a conscious decision: extend this list.
    const owners = new Map<string, Set<string>>();
    for (const [name, list] of Object.entries(SPECIFICITY_SETS)) {
      for (const keyword of list) {
        const key = keyword.toLowerCase();
        owners.set(key, (owners.get(key) ?? new Set()).add(name));
      }
    }
    const shared = [...owners.entries()]
      .filter(([, set]) => set.size > 1)
      .map(([keyword, set]) => `${keyword}:${[...set].sort().join('+')}`)
      .sort();
    expect(shared).toEqual([
      'buffer:calendarManagement+socialMedia',
      'engagement:dataAnalysis+socialMedia',
      'reel:socialMedia+videoGeneration',
      'testimonial:socialMedia+videoGeneration',
    ]);
  });

  it('keeps generic web-dev vocabulary out of web_browsing (misrouted coding, #1613)', () => {
    const lower = WEB_BROWSING_KEYWORDS.map((k) => k.toLowerCase());
    for (const generic of [
      'html',
      'dom',
      'url',
      'http',
      'link',
      'page',
      'site',
      'fetch',
      'google',
    ]) {
      expect(lower).not.toContain(generic);
    }
  });

  it('keeps every web_browsing keyword reachable by the activation threshold', () => {
    // A weak keyword may need a second signal, but a pair of phrases must be
    // able to clear the threshold or the category could never activate.
    const total = WEB_BROWSING_KEYWORDS.reduce((sum, k) => sum + weightFor(k), 0);
    expect(total).toBeGreaterThanOrEqual(ACTIVATION_THRESHOLDS.web_browsing);
  });
});

describe('specificity classification driven by the keyword sets', () => {
  const cases: Array<[SpecificityCategory, string[]]> = [
    [
      'web_browsing',
      [
        'navigate to the pricing page and scrape the table',
        'browse to this website and take a screenshot',
        'web search for the latest release notes',
        'open url https://example.com and click on the login button',
        'crawl this site and look up the contact page',
      ],
    ],
    [
      'data_analysis',
      [
        'compute the median and percentile of this dataset',
        'plot a histogram of the correlation between columns in the csv',
        'build a pivot table with pandas and compute the variance',
        'forecast the churn and retention of each cohort',
      ],
    ],
    [
      'image_generation',
      [
        'generate image of a mascot logo in pixel art',
        'create image with stable diffusion of a neon cityscape',
        'draw an illustration for the poster using midjourney',
        'inpaint the background and upscale the portrait',
      ],
    ],
    [
      'video_generation',
      [
        'generate video of a timelapse city with runway',
        'create video with a storyboard and keyframes',
        'text to video with kling for a trailer',
        'edit the footage with color grading and a voiceover',
      ],
    ],
    [
      'social_media',
      [
        'write a tweet with a hashtag for my followers',
        'schedule post on linkedin and instagram',
        'draft a post for the social media content calendar',
        'which influencer should repost this thread on twitter',
      ],
    ],
    [
      'email_management',
      [
        'draft email to my team with a clear subject line',
        'compose email with an attachment and bcc my manager',
        'reply to the newsletter in my inbox on gmail',
        'set up a drip campaign in mailchimp',
      ],
    ],
    [
      'calendar_management',
      [
        'reschedule my meeting on the calendar',
        'find a time slot for an appointment and check my availability',
        'block time for focus time every morning in google calendar',
        'add a recurring standup with a reminder',
      ],
    ],
    [
      'trading',
      [
        'should i buy bitcoin at this price with a stop loss',
        'analyze the market with the rsi and macd moving average',
        'place an order on binance for ethereum',
        'the stock is bullish after the earnings call',
      ],
    ],
    [
      'coding',
      [
        'write a python function to sort a list',
        'refactor this typescript class and fix the bug',
        'implement a REST API with express and add unit tests',
      ],
    ],
  ];

  describe.each(cases)('%s', (expected, prompts) => {
    it.each(prompts)('classifies %p', (prompt) => {
      expect(category(prompt)).toBe(expected);
    });
  });

  it('classifies nothing for a generic chat message', () => {
    expect(category('hello, how are you today?')).toBeNull();
    expect(category('thanks a lot')).toBeNull();
  });

  describe('case handling', () => {
    it.each([
      ['NAVIGATE TO the website and SCRAPE the prices', 'web_browsing'],
      ['Write A TWEET With A HASHTAG', 'social_media'],
      ['Draft Email With A Subject Line', 'email_management'],
      ['RESCHEDULE MY MEETING', 'calendar_management'],
      ['Generate Image Of A Mascot LOGO', 'image_generation'],
    ] as const)('is case-insensitive: %p', (prompt, expected) => {
      expect(category(prompt)).toBe(expected);
    });

    it('matches the uppercase DM keyword in any case', () => {
      const lower = scanMessages([{ role: 'user', content: 'send a dm to the influencer' }]);
      const upper = scanMessages([{ role: 'user', content: 'send a DM to the influencer' }]);
      expect(lower?.category).toBe('social_media');
      expect(upper?.category).toBe('social_media');
    });
  });

  describe('accent and non-ASCII handling', () => {
    it('matches ASCII keywords next to accented words', () => {
      expect(category('Por favor, navigate to the página e faça scrape')).toBe('web_browsing');
      expect(category('écrire un tweet avec un hashtag')).toBe('social_media');
      expect(category('ÉCRIRE UN TWEET AVEC UN HASHTAG')).toBe('social_media');
    });

    it('treats an accented letter as a word boundary on both sides', () => {
      expect(category('añadir email')).toBe('email_management');
      expect(category('email—ahora')).toBe('email_management');
    });

    it('does not match a keyword hidden inside a longer ASCII word', () => {
      expect(category('the emailing of results')).not.toBe('email_management');
      expect(category('a hashtagged item')).not.toBe('social_media');
    });

    it('does not crash on emoji, CJK or empty-ish content', () => {
      expect(() => category('日本語のテキスト 🎉 tweet')).not.toThrow();
      expect(category('日本語のテキスト 🎉')).toBeNull();
    });
  });

  describe('overlap resolution', () => {
    it('keeps a single weak shared keyword from flipping a coding request', () => {
      expect(category('write a python function that computes the median of a list')).toBe('coding');
    });

    it('lets a strong anchor win over an overlapping generic keyword', () => {
      expect(category('generate video storyboard for the reel')).toBe('video_generation');
    });

    it('does not read a bare URL-free "page" as web browsing', () => {
      expect(category('the page renders slowly')).not.toBe('web_browsing');
    });
  });
});

describe('complexity dimensions driven by the keyword sets', () => {
  const run = (text: string) => scoreRequest({ messages: [{ role: 'user', content: text }] });
  const matched = (text: string, dimension: string) =>
    run(text).dimensions.find((d) => d.name === dimension)?.matchedKeywords ?? [];

  it('records matches for representative keywords of each upward dimension', () => {
    expect(
      matched('compare the trade-offs and evaluate the implications', 'analyticalReasoning'),
    ).toEqual(expect.arrayContaining(['compare', 'trade-offs', 'evaluate', 'implications']));
    expect(
      matched('refactor this function and add a unit test for the handler', 'codeGeneration')
        .length,
    ).toBeGreaterThan(0);
  });

  it('sends formal-logic wording straight to the reasoning tier', () => {
    const result = run('Prove that there are infinitely many primes by contradiction');
    expect(result.tier).toBe('reasoning');
    expect(result.reason).toBe('formal_logic_override');
  });

  it('is case-insensitive for the formal-logic override', () => {
    expect(run('PROVE THIS THEOREM').reason).toBe('formal_logic_override');
  });

  it('does not trigger the override for a keyword inside another word', () => {
    expect(run('please improve the layout of this screen').reason).not.toBe(
      'formal_logic_override',
    );
  });

  it('scores a short greeting lower than a multi-requirement engineering request', () => {
    const simple = run('hi');
    const hard = run(
      'Design a distributed rate limiter. Compare the trade-offs of token bucket and sliding ' +
        'window, evaluate the implications for latency, then implement it in TypeScript with ' +
        'unit tests and benchmark the throughput under load.',
    );
    expect(hard.score).toBeGreaterThan(simple.score);
  });
});
