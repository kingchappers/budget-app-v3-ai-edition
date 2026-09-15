export type LogFields = Record<string, string | number | boolean>;
export type Logger = (event: string, fields: LogFields) => void;

export const jsonLogger: Logger = (event, fields) => {
  console.log(JSON.stringify({ event, ...fields }));
};
