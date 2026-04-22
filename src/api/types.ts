export interface Link {
  rel: string;
  href: string;
  prompt?: string;
}

export interface CollectionDataField {
  name: string;
  value: unknown;
}

export interface CollectionItem {
  href: string;
  data: CollectionDataField[];
  links?: Link[];
}

export interface CollectionResponse {
  collection: {
    version: string;
    href: string;
    items?: CollectionItem[];
    links?: Link[];
    error?: { title: string; message: string };
  };
}

export type ParsedItem = Record<string, unknown> & {
  _href?: string;
  _links?: Link[];
};

export interface CollectionErrorResponse {
  collection: {
    error?: {
      title?: string;
      message?: string;
      code?: string;
    };
  };
}
