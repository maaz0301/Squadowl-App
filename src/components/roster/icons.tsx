import Svg, { Circle, Path, Polyline } from 'react-native-svg';

/**
 * The small line icons the roster screen's controls are built from.
 *
 * Kept together, at one size and one stroke weight, because they sit side by
 * side in a single row of buttons — an icon a pixel heavier than its neighbour
 * is obvious there in a way it never is on its own.
 */
interface IconProps {
  color: string;
  size?: number;
}

const STROKE = 2;

export function PlayIcon({ color, size = 18 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M6 4.5l13 7.5-13 7.5V4.5z" fill={color} stroke={color} strokeWidth={STROKE} strokeLinejoin="round" />
    </Svg>
  );
}

export function PlusIcon({ color, size = 18 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 5v14M5 12h14" stroke={color} strokeWidth={STROKE} strokeLinecap="round" />
    </Svg>
  );
}

export function UploadIcon({ color, size = 18 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"
        stroke={color}
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Polyline
        points="17 8 12 3 7 8"
        stroke={color}
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path d="M12 3v12" stroke={color} strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function ToolsIcon({ color, size = 18 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M4 6h16M4 12h16M4 18h16" stroke={color} strokeWidth={STROKE} strokeLinecap="round" />
      <Circle cx={9} cy={6} r={2.2} fill={color} />
      <Circle cx={15} cy={12} r={2.2} fill={color} />
      <Circle cx={8} cy={18} r={2.2} fill={color} />
    </Svg>
  );
}

export function SearchIcon({ color, size = 18 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={11} cy={11} r={7} stroke={color} strokeWidth={STROKE} />
      <Path d="M20 20l-3.5-3.5" stroke={color} strokeWidth={STROKE} strokeLinecap="round" />
    </Svg>
  );
}

export function ClearIcon({ color, size = 18 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={9} fill={color} opacity={0.18} />
      <Path d="M9 9l6 6M15 9l-6 6" stroke={color} strokeWidth={STROKE} strokeLinecap="round" />
    </Svg>
  );
}

export function ChevronIcon({ color, size = 18 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M9 5l7 7-7 7" stroke={color} strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function CheckSquareIcon({ color, size = 18 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"
        stroke={color}
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
