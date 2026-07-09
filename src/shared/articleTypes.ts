export type ArticleStructureType =
  | 'standard'
  | 'problem_solution'
  | 'comparison'
  | 'practical'
  | 'seo_comprehensive'
  | 'conversion';

export interface ArticleOutlineSection {
  title: string;
  level?: number;
  isLead?: boolean;
}

export interface ArticleOutline {
  title?: string;
  sections?: ArticleOutlineSection[];
}
