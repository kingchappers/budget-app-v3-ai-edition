import { Image, type ImageProps } from '@mantine/core';
import lockupLight from '../../../docs/brand/logo/hoardwise-lockup.svg';
import lockupDark from '../../../docs/brand/logo/hoardwise-lockup-dark-bg.svg';
import markLight from '../../../docs/brand/logo/hoardwise-mark.svg';
import markDark from '../../../docs/brand/logo/hoardwise-mark-dark-bg.svg';

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

// The mark alone, square. Keep at least the coin's radius of clear space around it (docs/brand.md).
// Decorative by default: pass a label when it is the only thing naming the page.
export function Mark({ size, alt = '', ...props }: { size: number; alt?: string } & Omit<ImageProps, 'src' | 'w' | 'h'>) {
  return (
    <>
      <Image src={markLight} alt={alt} darkHidden fit="contain" w={size} h={size} {...props} />
      <Image src={markDark} alt={alt} lightHidden fit="contain" w={size} h={size} {...props} />
    </>
  );
}
