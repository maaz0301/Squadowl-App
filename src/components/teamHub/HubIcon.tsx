import Svg, { Path } from 'react-native-svg';

export function HubIcon({
  d,
  size = 18,
  color,
  strokeWidth = 2,
}: {
  d: string;
  size?: number;
  color: string;
  strokeWidth?: number;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d={d} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
