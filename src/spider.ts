import { EventEmitter } from "events";
import * as pRetry from "p-retry";
import * as uuid from "uuid";
import {
  IOptions,
  IOpts,
  IPipe,
  IPipeItems,
  IPlan,
  IQueue,
  IState,
  IStatus,
  ITask,
} from "./interfaces";
import defaultPlan from "./plan/defaultPlan";
import downloadPlan from "./plan/downloadPlan";
import Queue from "./queue";

const defaultOption: IOpts = {
  concurrency: 20,
  queue: new Queue(),
  pool: new Set<string>(),
};

const e = {
  statusChange: "statusChange",
  addTask: "addTask",
  queueEmpty: "queueEmpty",
  heartbeat: "heartbeat",
  goodbye: "goodbye",
};

/**
 * class of NodeSpider
 * @class NodeSpider
 */
export default class NodeSpider extends EventEmitter {
  public _STATE: IState;
  /**
   * create an instance of NodeSpider
   * @param option
   */
  constructor(option: IOptions = {}) {
    super();
    const opts = { ...defaultOption, ...option };
    this._STATE = {
      opts,
      currentTasks: [],
      pipeStore: new Map(),
      planStore: [],
      queue: opts.queue,
      heartbeat: setInterval(() => this.emit(e.heartbeat), 4000),
      pool: opts.pool,
      status: "vacant",   // 初始化后，在获得新任务前，将保持“空闲”状态
    };

    this.on(e.queueEmpty, () => {
      if (this._STATE.currentTasks.length === 0) {
        changeStatus("vacant", this);
      }
    });
    this.on(e.addTask, () => {
      if (this._STATE.status === "vacant") {
        changeStatus("active", this);
      }
      startTask(this);
    });
    this.on(e.heartbeat, () => startTask(this));
  }

  /**
   * 终止爬虫
   */
  public end() {
    changeStatus("end", this);
    for (const { pipe } of this._STATE.pipeStore.values()) {
      pipe.end();
    }
    clearInterval(this._STATE.heartbeat);
    this.emit(e.goodbye);
  }

  /**
   * Check whether the url has been added
   * @param {string} url
   * @returns {boolean}
   */
  public has(url: string): boolean {
    if (typeof url !== "string") {
      throw new TypeError(`the parameter of method isExist should be a string`);
    }
    return this._STATE.pool.has(url);
  }

  /**
   * 过滤掉一个数组中的重复链接，以及所有已被添加的链接，返回一个新数组
   * @param urlArray {array}
   * @returns {array}
   */
  public filter(urlArray: string[]): string[] {
    if (!Array.isArray(urlArray)) {
      throw new TypeError("the parameter of the method filter is required, and can only be an array of strings");
    } else {
      const s = new Set(urlArray);
      const result: string[] = [];
      for (const url of s) {
        if (typeof url !== "string") {
          throw new TypeError(
            "the parameter of the method filter is required, and can only be an array of strings",
          );
        }
        if (!this.has(url)) {
          result.push(url);
        }
      }
      return result;
    }
  }

  /**
   * add new plan
   * @param  {IPlan}  plan plan object
   * @return {void}
   */
  public plan(plan: IPlan): void {
    if (this._STATE.planStore.find((p) => p.name === plan.name)) {
      throw new TypeError(`method add: there already have a plan named "${plan.name}"`);
    }
    this._STATE.planStore.push(plan);
  }

  /**
   * connect new pipe
   * @param  {IPipe}  target pipe object
   * @return {void}
   */
  public pipe(name: string, target: IPipe, items: IPipeItems = []): void {
    if (this._STATE.pipeStore.has(name)) {
      throw new TypeError(`method connect: there already have a pipe named "${name}"`);
    }
    this._STATE.pipeStore.set(name, { items, pipe: target });
  }

  public retry(current: ITask, maxRetry: number, finalErrorCallback?: () => any): void {
    // 过滤出current重要的task基本信息
    const retryTask = {
      uid: current.uid,
      hasRetried: current.hasRetried,
      info: current.info,
      planName: current.planName,
      url: current.url,
    };
    if (!retryTask.hasRetried) {
      retryTask.hasRetried = 0;
    }
    if (!finalErrorCallback) {
      finalErrorCallback = () => {
        throw new Error(`
                    ${current.url}达到最大重试次数，但依然出错
                `);
      };
    }
    if (retryTask.hasRetried >= maxRetry) {
      return finalErrorCallback();
    }
    retryTask.hasRetried++;
    this._STATE.queue.jump(retryTask);    // 插队到队列，重新等待执行
    this.emit(e.addTask, retryTask);    // TODO: 确定让重试任务也触发“addTask”事件？
  }

  /**
   * add new tasks, return tasks' uuids
   * @param planName target plan name
   * @param url url(s)
   * @param info attached information
   */
  public add(planName: string, url: string | string[], info?: { [index: string]: any }): string[] {
    const plan = this._STATE.planStore.find((p) => p.name === planName);
    if (!plan) {
      throw new TypeError(`method queue: no such plan named "${planName}"`);
    }
    const urls = Array.isArray(url) ? url : [url];

    const tasks = urls.map((u) => ({ uid: uuid(), url: u, planName, info }));
    for (const task of tasks) {
      this._STATE.queue.add(task);
      this._STATE.pool.add(task.url);
      this.emit(e.addTask, task);
    }

    return tasks.map((t) => t.uid);
  }

  // public download(path: string, url: string, filename?: string) {
  //     if (typeof path !== "string") {
  //         throw new TypeError(`method download: the parameter 'path' should be a string`);
  //     }
  //     if (typeof url !== "string") {
  //         throw new TypeError(`method download: the parameter 'url' should be a string`);
  //     }
  //     // 如果不存在与该path相对应的 download plan，则新建一个
  //     if (! this._STATE.planStore.has(path)) {
  //         const newPlan = downloadPlan({
  //             callback: (err, current, s) => {
  //                 if (err) {
  //                     return s.retry(current, 3, () => console.log(err));
  //                 }
  //             },
  //             path,
  //         });
  //         this.plan(name, newPlan);
  //     }
  //     // 添加下载链接 url 到队列
  //     this.add(path, url, { filename });
  // }

  /**
   * Save data through a pipe
   * @param  {string} pipeName pipe name
   * @param  {any}    data     data you need to save
   * @return {void}
   */
  public save(pipeName: string, data: { [index: string]: any }) {
    if (typeof pipeName !== "string") {
      throw new TypeError(`methdo save: the parameter "pipeName" should be a string`);
    }
    if (typeof data !== "object") {
      throw new TypeError(`method save: the parameter "data" should be an object`);
    }
    const store = this._STATE.pipeStore.get(pipeName);
    if (!store) {
      throw new TypeError(`method save: no such pipe named ${pipeName}`);
    }

    const { pipe } = store;
    let { items } = store;
    const d: { [index: string]: any } = {};
    if (Array.isArray(items)) {
      if (items.length === 0) {
        store.items = Object.keys(data);
        items = store.items;
      }
      for (const key of items) {
        if (typeof data[key] === "undefined") {
          d[key] = null;
        } else {
          d[key] = data[key];
        }
      }
    } else {
      for (const key of Object.keys(items)) {
        const fn = items[key];
        if (typeof data[key] === "undefined") {
          d[key] = null;
        } else {
          d[key] = fn(data[key]);
        }
      }
    }
    if (pipe.convert) {
      pipe.write(pipe.convert(d));
    } else {
      pipe.write(JSON.stringify(d));
    }
  }
}

function changeStatus(status: IStatus, spider: NodeSpider) {
  const preStatus = spider._STATE.status;
  spider._STATE.status = status;
  spider.emit(e.statusChange, status, preStatus);
}

async function startTask(spider: NodeSpider) {
  if (spider._STATE.status === "active") {
    const maxConcurrency = spider._STATE.opts.concurrency;
    const currentTasksNum = spider._STATE.currentTasks.length;
    if (maxConcurrency - currentTasksNum > 0) {
      const currentTask = spider._STATE.queue.next();
      if (!currentTask) {
        spider.emit(e.queueEmpty);
      } else {
        spider._STATE.currentTasks.push(currentTask);
        startTask(spider);    // 不断递归，使爬虫并发任务数量尽可能达到最大限制

        const plan = spider._STATE.planStore.find((p) => p.name === currentTask.planName) as IPlan;
        await pRetry(() => plan.process(currentTask, spider), { retries: plan.retries }).catch(plan.catch);

        spider._STATE.currentTasks = spider._STATE.currentTasks.filter(({ uid }) => uid !== currentTask.uid);
      }
    }
  }
}
