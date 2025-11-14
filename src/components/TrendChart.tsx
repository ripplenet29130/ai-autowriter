import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface TrendChartProps {
  data: Array<{
    time: string;
    formattedTime: string;
    value: number[];
  }>;
}

export default function TrendChart({ data }: TrendChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-gray-500">
        データがありません
      </div>
    );
  }

  const chartData = data.map((item) => ({
    date: item.formattedTime,
    value: item.value[0] || 0,
  }));

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 12, fill: "#6b7280" }}
          tickMargin={10}
        />
        <YAxis
          tick={{ fontSize: 12, fill: "#6b7280" }}
          tickMargin={10}
          label={{
            value: "検索トレンド",
            angle: -90,
            position: "insideLeft",
            style: { fontSize: 12, fill: "#6b7280" },
          }}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "#ffffff",
            border: "1px solid #e5e7eb",
            borderRadius: "8px",
            padding: "8px 12px",
          }}
          labelStyle={{ color: "#374151", fontWeight: 600 }}
        />
        <Line
          type="monotone"
          dataKey="value"
          stroke="#2563eb"
          strokeWidth={2}
          dot={{ fill: "#2563eb", r: 4 }}
          activeDot={{ r: 6 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
