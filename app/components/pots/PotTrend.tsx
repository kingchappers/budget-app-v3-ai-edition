const WIDTH = 100;
const HEIGHT = 32;

export function trendPoints(values: number[], width: number = WIDTH, height: number = HEIGHT): string {
  if (values.length < 2) return '';
  const min = Math.min(...values);
  const range = Math.max(...values) - min || 1;
  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - ((value - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

export function PotTrend({ values, label = 'Balance trend' }: { values: number[]; label?: string }) {
  const points = trendPoints(values);
  if (points === '') return null;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height: 48, display: 'block' }}
    >
      <polyline points={points} fill="none" stroke="var(--mantine-color-primary-6)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
