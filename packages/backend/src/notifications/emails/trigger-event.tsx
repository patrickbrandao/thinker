import { getEmailAssetUrl } from '../../common/utils/dashboard-url';
import * as React from 'react';
import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Text,
  Preview,
  Hr,
  Link,
  Img,
  Button,
} from '@react-email/components';
import { alertEmailStyles as s } from './threshold-alert';

export interface TriggerEventEmailProps {
  badge: string;
  title: string;
  /** Rendered body template, one paragraph per line. */
  text: string;
  timestamp: string;
  url?: string;
  logoUrl?: string;
}

/** Layout for trigger e-mails other than limit alerts (same look as threshold-alert). */
export function TriggerEventEmail(props: TriggerEventEmailProps) {
  const {
    badge,
    title,
    text,
    timestamp,
    url,
    logoUrl = getEmailAssetUrl('thinker-logo.png'),
  } = props;
  return (
    <Html>
      <Head />
      <Preview>{title}</Preview>
      <Body style={s.body}>
        <Container style={s.container}>
          <Section style={s.logoSection}>
            <Img
              src={logoUrl}
              alt="Thinker LLM Gateway"
              width="174"
              height="32"
              style={s.logoImg}
            />
          </Section>
          <Section style={s.card}>
            <Section style={s.alertBadgeContainer}>
              <Text style={{ ...s.alertBadge, color: '#475569', backgroundColor: '#f1f5f9' }}>
                {badge}
              </Text>
            </Section>
            <Text style={s.heading}>{title}</Text>
            {text
              .split(/\n+/)
              .filter((line) => line.trim())
              .map((line, i) => (
                <Text key={i} style={s.paragraph}>
                  {line}
                </Text>
              ))}
            <Section style={s.metaRow}>
              <Text style={s.metaText}>{timestamp}</Text>
            </Section>
            {url ? (
              <Section style={s.ctaContainer}>
                <Button style={s.ctaButton} href={url}>
                  Open in Thinker →
                </Button>
              </Section>
            ) : null}
          </Section>
          <Hr style={s.divider} />
          <Section style={s.footer}>
            <Text style={s.footerMuted}>
              Sent by a Thinker event trigger.{' '}
              <Link href="https://github.com/patrickbrandao/thinker" style={s.footerLink}>
                github.com/patrickbrandao/thinker
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
