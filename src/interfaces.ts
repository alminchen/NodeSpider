import * as fs from "fs";
import Spider from "./spider";

export interface IPlan {
  name: string;
  retries: number;
  process: (task: ITask, spider: Spider) => Promise<any>;
  failed: (error: Error, task: ITask, spider: Spider) => any;
}

export interface IQueue {
  add: (task: ITask) => void;
  jump: (task: ITask) => void;
  next: () => ITask | null;
  getLength: () => number;
}

export interface IPool {
  add: (url: string) => void;
  has: (url: string) => boolean;
  size: number;
}

export interface IPipe {
  name: string;
  items: IPipeItems;
  write: (data: any[]) => any;
  end: () => any;
}

export type IPipeItems = string[] | { [index: string]: (data: any) => any };

export type IStatus = "active" | "end" | "pause" | "vacant";

// NodeSpider' state
export interface IState {
  queue: IQueue;
  pool: IPool;
  planStore: IPlan[];
  pipeStore: IPipe[];
  opts: IOpts;
  currentTasks: ITask[];

  status: IStatus;
  heartbeat: NodeJS.Timer;
}

// 用于初始化时的函数参数
export interface IOptions {
  concurrency?: number;
  queue?: IQueue;
  pool?: IPool;
  heartbeat?: number;
  genUUID?: () => string;
  stillAlive?: boolean;
}
// 记录在state中的设置
export interface IOpts {
  concurrency: number;
  queue: IQueue;
  pool: IPool;
  heartbeat: number;
  genUUID: () => string;
  stillAlive: boolean;
}

// for task object in the queue;在queue保存的task
export interface ITask {
  uid: string;
  url: string;
  planName: string;
  info?: { [index: string]: any };
}
