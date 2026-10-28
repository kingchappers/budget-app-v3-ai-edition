import { Image, type ImageProps } from '@mantine/core';
import lockupLight from '../../../docs/brand/logo/hoardwise-lockup.svg';
import lockupDark from '../../../docs/brand/logo/hoardwise-lockup-dark-bg.svg';

// The lockup is 564x160. The light-background version has a green dragon; the dark-background version
// is all gold. Both are rendered and CSS shows the one for the current scheme, so a visitor whose
// scheme is set in Settings never sees the wrong one flash up first.
const LOCKUP_RATIO = 564 / 160;

interface LogoProps extends Omit<ImageProps, 'src' | 'w' | 'h'> {
  height: number;
}

export function Logo({ height, ...props }: LogoProps) {
  const size = { h: height, w: Math.round(height * LOCKUP_RATIO) };
  return (
    <>
      <Image src={lockupLight} alt="Hoardwise" darkHidden fit="contain" {...size} {...props} />
      <Image src={lockupDark} alt="Hoardwise" lightHidden fit="contain" {...size} {...props} />
    </>
  );
}
