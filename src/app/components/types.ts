export type Meta = {
  roles: { slug: string; label: string; family: string }[];
  cities: { slug: string; label: string; tier: number }[];
  levels: { slug: string; label: string }[];
  companyTypes: { slug: string; label: string }[];
  inflation: { series: { year: number; cpiInflationPct: number; provisional?: boolean }[]; note: string };
  stats: {
    totalReports: number;
    realReports: number;
    seedReports: number;
    pendingReview: number;
    rolesCovered: number;
    citiesCovered: number;
  } | null;
  aiEnabled: boolean;
};
