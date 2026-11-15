/** Recharts visuals for the Impact page — code-split so recharts only loads there. */

import {
  Area,
  AreaChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const PIE_COLORS = ["#2A6E4C", "#D98E14", "#E14B2E", "#8DC3A0", "#EABD5C"];

export function RescuesAreaChart({ data }: { data: Array<{ day: string; rescues: number }> }) {
  return (
    <div className="h-52">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <defs>
            <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2A6E4C" stopOpacity={0.7} />
              <stop offset="100%" stopColor="#2A6E4C" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={11} />
          <YAxis hide />
          <Tooltip
            contentStyle={{ borderRadius: 12, border: "1px solid #E7DCC3", background: "#FFFDF6", fontSize: 12 }}
            formatter={(value: number) => [`${value} rescues`, null]}
          />
          <Area type="monotone" dataKey="rescues" stroke="#2A6E4C" strokeWidth={3} fill="url(#fill)" animationDuration={1200} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function FoodMixPie({ data }: { data: Array<{ name: string; value: number }> }) {
  return (
    <div className="mt-2 h-52">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius="55%"
            outerRadius="85%"
            paddingAngle={4}
            animationDuration={1100}
          >
            {data.map((entry, index) => (
              <Cell key={entry.name} fill={PIE_COLORS[index % PIE_COLORS.length]} stroke="none" />
            ))}
          </Pie>
          <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #E7DCC3", background: "#FFFDF6", fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

export function MixLegend({ data }: { data: Array<{ name: string }> }) {
  return (
    <ul className="mt-1 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs font-semibold">
      {data.map((entry, index) => (
        <li key={entry.name} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: PIE_COLORS[index % PIE_COLORS.length] }} aria-hidden />
          {entry.name}
        </li>
      ))}
    </ul>
  );
}
