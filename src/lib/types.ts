export type Note = {
  id: string;
  title: string;
  body: string;
  tags: string[];
  /** Lokalt opplastet bilde som dataURL */
  image?: string;
  /** Ekstern bilde-URL (f.eks. favicon/apple-touch-icon fra delt nettside) */
  imageUrl?: string;
  createdAt: number;
  updatedAt: number;
};

export type TagIndex = Record<string, Set<string>>;
export type TagColorMap = Record<string, string>;
