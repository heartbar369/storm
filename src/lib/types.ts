export type Note = {
  id: string;
  title: string;
  body: string;
  tags: string[];
  image?: string; // dataURL
  createdAt: number; // ms
  updatedAt: number; // ms
};

export type TagIndex = Record<string, Set<string>>; // tag -> noteIds

export type TagColorMap = Record<string, string>; // tag -> hex
