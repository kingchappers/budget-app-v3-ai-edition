import { Button, Card, Stack, Text, Title } from '@mantine/core';
import { useAuth0 } from '@auth0/auth0-react';
import { DefaultLayout } from '~/components/layout/DefaultLayout';
import { SHOTS, SIZES, shotUrl, type Shot } from '~/lib/aboutShots';
import { GLOSSARY } from '~/lib/glossary';
import { pageTitle } from '~/lib/pageTitle';
import { SESSION_LIFETIME_TEXT } from '~/lib/sessionLifetime';
import type { Route } from './+types/about';

const FAQ = [
  {
    question: 'What is a pot?',
    answer: `${GLOSSARY.pot.definition} ${GLOSSARY.pot.example}`,
  },
  {
    question: 'What is a budget?',
    answer: `${GLOSSARY.target.definition} ${GLOSSARY.target.example}`,
  },
  {
    question: 'How do recurring bills work?',
    answer: 'Add a bill once and the app shows it on Home when it is due. Nothing is added until you confirm it with one tap.',
  },
  {
    question: 'Can I put it on my phone?',
    answer: 'Yes. Open the app in your phone browser and use "Add to Home Screen". It then opens like any other app.',
  },
];

function SignInButton() {
  const { loginWithRedirect } = useAuth0();

  async function signIn(): Promise<void> {
    try {
      await loginWithRedirect();
    } catch (error) {
      console.error('About: could not start sign-in', error);
    }
  }

  return <Button size="lg" onClick={() => void signIn()}>Sign in</Button>;
}

function ShotImage({ shot, first }: { shot: Shot; first: boolean }) {
  const { phone, desktop } = SIZES;
  return (
    <picture>
      <source media="(max-width: 767px) and (prefers-color-scheme: dark)" srcSet={shotUrl(shot.id, 'phone', 'dark')} />
      <source media="(max-width: 767px)" srcSet={shotUrl(shot.id, 'phone', 'light')} />
      <source media="(prefers-color-scheme: dark)" srcSet={shotUrl(shot.id, 'desktop', 'dark')} />
      <img
        src={shotUrl(shot.id, 'desktop', 'light')}
        alt={shot.alt}
        width={desktop.width}
        height={desktop.height}
        loading={first ? undefined : 'lazy'}
        style={{ width: '100%', height: 'auto', maxWidth: phone.width * 2, borderRadius: 8, border: '1px solid var(--mantine-color-default-border)' }}
      />
    </picture>
  );
}

function AboutContent() {
  return (
    <Stack maw={820} mx="auto" gap="xl">
      <Stack gap="sm">
        <Title order={1} size="h2">A calm way to keep track of your money</Title>
        <Text>
          Budget is a small app for knowing what you have left to spend. Add what you buy, set a budget only if you want one,
          and keep money apart in pots for the things you are saving towards. It works on a phone and on a computer, and it
          can be hosted by you.
        </Text>
        <Text size="sm" c="dimmed">{SESSION_LIFETIME_TEXT}</Text>
        <div><SignInButton /></div>
      </Stack>

      {SHOTS.map((shot, index) => (
        <Stack key={shot.id} id={`sec-${shot.id}`} gap="xs" component="section">
          <Title order={2} size="h3">{shot.heading}</Title>
          <Text>{shot.caption}</Text>
          <Text size="sm" c="dimmed">{shot.howTo}</Text>
          <ShotImage shot={shot} first={index === 0} />
        </Stack>
      ))}

      <Stack gap="sm" component="section">
        <Title order={2} size="h3">Common questions</Title>
        {FAQ.map(({ question, answer }) => (
          <Card key={question} withBorder>
            <Title order={3} size="h5" mb={4}>{question}</Title>
            <Text size="sm">{answer}</Text>
          </Card>
        ))}
      </Stack>

      <Stack align="center" gap="sm" py="lg">
        <Text fw={600}>Ready to try it?</Text>
        <SignInButton />
      </Stack>
    </Stack>
  );
}

export const meta: Route.MetaFunction = () => [{ title: pageTitle('About') }];

export default function About() {
  return (
    <DefaultLayout>
      <AboutContent />
    </DefaultLayout>
  );
}
