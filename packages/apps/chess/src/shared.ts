export type ChessColor = 'white' | 'black';

export type ChessPlayerMap = {
  white?: string;
  black?: string;
};

export type ChessMovePayload = {
  from: string;
  to: string;
  promotion?: string;
};

export type ChessState = {
  fen: string;
  turn: ChessColor;
  players: ChessPlayerMap;
  status: string;
  pgn: string;
};
