interface DonutChartProps {
  segments: Array<{
    value: number;
    color: string;
    label: string;
  }>;
  centerText?: string;
  centerValue?: string;
  size?: number;
}

export function DonutChart({
  segments,
  centerText,
  centerValue,
  size = 150,
}: DonutChartProps) {
  const radius = size / 2;
  const innerRadius = radius * 0.5;
  const strokeWidth = radius - innerRadius;
  const circumference = 2 * Math.PI * (radius - strokeWidth / 2);

  let currentAngle = -90; // Start from top

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Background circle */}
      <circle
        cx={radius}
        cy={radius}
        r={radius - strokeWidth / 2}
        fill="none"
        stroke="rgba(255,255,255,0.06)"
        strokeWidth={strokeWidth}
      />

      {/* Segments */}
      {segments.map((segment, idx) => {
        const percentage = segment.value / 100;
        const segmentLength = circumference * percentage;
        const offset = circumference - segmentLength;

        const rotation = currentAngle;
        currentAngle += (segment.value / 100) * 360;

        return (
          <circle
            key={idx}
            cx={radius}
            cy={radius}
            r={radius - strokeWidth / 2}
            fill="none"
            stroke={segment.color}
            strokeWidth={strokeWidth}
            strokeDasharray={`${segmentLength} ${circumference}`}
            strokeDashoffset={-offset}
            transform={`rotate(${rotation} ${radius} ${radius})`}
            style={{
              transition: "all 0.6s ease",
            }}
          />
        );
      })}

      {/* Center text */}
      {centerText && (
        <>
          <text
            x={radius}
            y={radius - 8}
            textAnchor="middle"
            fill="#A9B2BF"
            fontSize="12"
            fontWeight="600"
            fontFamily="ui-sans-serif, system-ui"
          >
            {centerText}
          </text>
          {centerValue && (
            <text
              x={radius}
              y={radius + 12}
              textAnchor="middle"
              fill="#E6E9EF"
              fontSize="24"
              fontWeight="bold"
              fontFamily="ui-monospace, monospace"
            >
              {centerValue}
            </text>
          )}
        </>
      )}
    </svg>
  );
}
