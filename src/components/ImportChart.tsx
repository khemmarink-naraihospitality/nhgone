import React from 'react';

interface ChartData {
  date: string;
  count: number;
}

interface ImportChartProps {
  data: ChartData[];
  title?: string;
  description?: string;
  unitLabel?: string;
}

export default function ImportChart({ data, title = "Import Stats", description = "Performance metrics for Narai portfolio syncing.", unitLabel = "Records" }: ImportChartProps) {
  const chartHeight = 200;
  const padding = 20;

  const content = (
    <div className="w-full bg-[#fffaf0] border border-[#152A00]/14 p-10 mt-10">
      <div className="flex items-center justify-between mb-12">
        <div>
          <h3 className="font-display text-2xl text-[#152A00] leading-none">{title}</h3>
          <p className="text-[10px] text-[#152A00]/50 mt-2 tracked-caps uppercase">{description}</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1 bg-[#152A00]/5 border border-[#152A00]/10">
          <div className="w-1.5 h-1.5 rounded-full bg-[#152A00]"></div>
          <span className="text-[9px] font-bold text-[#152A00] tracked-caps uppercase">System Sync</span>
        </div>
      </div>

      {!data || data.length === 0 ? (
        <div className="h-[240px] flex items-center justify-center border-t border-[#152A00]/5">
          <p className="text-[#152A00]/40 font-display text-xl italic italic opacity-50 font-medium">No record history available.</p>
        </div>
      ) : (
        <div className="relative w-full overflow-x-auto pb-4">
          <div className="min-w-[600px] flex items-end justify-between gap-6 h-[240px] px-2 pt-8">
            {data.map((item, index) => {
              const maxCount = Math.max(...data.map(d => d.count), 1);
              const heightPercentage = Math.max((item.count / maxCount) * 100, 4);
              
              return (
                <div key={index} className="flex-1 flex flex-col items-center gap-4 group relative">
                  {/* Tooltip */}
                  <div className="absolute -top-10 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10 flex flex-col items-center pointer-events-none">
                    <div className="bg-[#152A00] text-[#FFEFD2] text-[10px] font-bold px-3 py-1.5 tracked-caps shadow-xl whitespace-nowrap">
                      {item.count} {unitLabel}
                    </div>
                  </div>

                  {/* Bar */}
                  <div className="w-full relative flex flex-col justify-end items-center h-[160px] bg-[#152A00]/5">
                     <div 
                       className="w-full bg-[#152A00] transition-all duration-700 ease-out flex items-start justify-center pt-2 group-hover:bg-[#A76400]"
                       style={{ height: `${heightPercentage}%` }}
                     >
                       {heightPercentage > 20 && (
                         <span className="text-[9px] font-bold text-[#FFEFD2]/60 font-sans">{item.count}</span>
                       )}
                     </div>
                  </div>

                  {/* Label */}
                  <div className="text-[10px] font-bold text-[#152A00]/40 text-center tracked-caps transition-colors whitespace-nowrap group-hover:text-[#152A00]">
                    {item.date}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );

  return content;
}
