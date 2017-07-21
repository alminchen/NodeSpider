"use strict";
// TODO: 更好的报错机制: 报错建议？以及去除多余的 console.error
// BUG: 使用url.resolve补全url，可能导致 'http://www.xxx.com//www.xxx.com' 的问题。补全前，使用 is-absolute-url 包判断, 或考录使用 relative-url 代替
// TODO: 使用 node 自带 stringdecode 代替 iconv-lite
// mysql 插件
// redis queue
// TODO B 注册pipe和queue可能存在异步操作，此时应该封装到promise或async函数。但依然存在问题：当还没注册好，就调动了queue或者save
// TODO C 兼容新 plan 系统的 queue
// TODO C 更良好的报错提示
Object.defineProperty(exports, "__esModule", { value: true });
const events_1 = require("events");
const uuid = require("uuid");
const defaultPlan_1 = require("./defaultPlan");
const queue_1 = require("./queue");
const plan_1 = require("./plan");
const defaultOption = {
    multiDownload: 2,
    multiTasking: 20,
    queue: queue_1.default,
    rateLimit: 2,
};
/**
 * class of NodeSpider
 * @class NodeSpider
 */
class NodeSpider extends events_1.EventEmitter {
    /**
     * create an instance of NodeSpider
     * @param opts
     */
    constructor(opts = {}) {
        super();
        // TODO B opts 检测是否合法
        const finalOption = Object.assign({}, defaultOption, opts);
        this._STATE = {
            currentMultiDownload: 0,
            currentMultiTask: 0,
            dlPlanStore: new Map(),
            option: finalOption,
            pipeStore: new Map(),
            planStore: new Map(),
            queue: new finalOption.queue(),
            timer: null,
            working: true,
        };
        this.on("end", () => {
            // some code，如果没有需要，就删除
        });
        this._STATE.timer = setInterval(() => {
            if (this._STATE.currentMultiTask < this._STATE.option.multiTasking) {
                startCrawl(this);
            }
            if (this._STATE.currentMultiDownload < this._STATE.option.multiDownload) {
                startDownload(this);
            }
        }, this._STATE.option.rateLimit);
    }
    end() {
        // 爬虫不再定时从任务队列获得新任务
        clearInterval(this._STATE.timer);
        // 关闭注册的pipe
        for (const pipe of this._STATE.pipeStore.values()) {
            pipe.close();
        }
        // TODO C 更多，比如修改所有method来提醒开发者已经end
        // 触发事件，将信号传递出去
        this.emit("end");
    }
    /**
     * Check whether the url has been added
     * @param {string} url
     * @returns {boolean}
     */
    isExist(url) {
        if (typeof url !== "string") {
            throw new Error("method check need a string-typed param");
        }
        return this._STATE.queue.check(url);
    }
    /**
     * 过滤掉一个数组中的重复链接，以及所有已被添加的链接，返回一个新数组
     * @param urlArray {array}
     * @returns {array}
     */
    filter(urlArray) {
        if (!Array.isArray(urlArray)) {
            throw new Error("method filter need a array-typed param");
        }
        else {
            const s = new Set(urlArray);
            const result = [];
            for (const url of s) {
                if (!this.isExist) {
                    result.push(url);
                }
            }
            return result;
        }
    }
    /**
     * Retry the task within the maximum number of retries
     * @param {ITask} task The task which want to retry
     * @param {number} maxRetry Maximum number of retries for this task
     * @param {function} finalErrorCallback The function called when the maximum number of retries is reached
     */
    retry(current, maxRetry = 1, finalErrorCallback) {
        const task = {
            hasRetried: current.hasRetried,
            maxRetry: current.maxRetry,
            planKey: current.planKey,
            special: current.special,
            url: current.url,
        };
        if (!task.hasRetried) {
            task.hasRetried = 0;
        }
        if (!task.maxRetry) {
            task.maxRetry = maxRetry;
        }
        if (!finalErrorCallback) {
            finalErrorCallback = (currentTask) => {
                console.log("达到最大重试次数，但依旧错误");
            };
        }
        if (task.hasRetried >= task.maxRetry) {
            return finalErrorCallback(current);
        }
        // 判断是哪种任务，crawl or download?
        let jumpFun = null;
        if (this._STATE.planStore.has(task.planKey)) {
            jumpFun = this._STATE.queue.jumpTask;
        }
        else if (this._STATE.dlPlanStore.has(task.planKey)) {
            jumpFun = this._STATE.queue.jumpDownload;
        }
        else {
            return new Error("unknown plan");
        }
        // 重新添加到队列
        task.hasRetried++;
        jumpFun(task);
    }
    plan(item) {
        let newPlan = item;
        if (item instanceof plan_1.default) {
            newPlan = item;
        }
        else {
            newPlan = defaultPlan_1.default(item);
        }
        const key = Symbol(`${newPlan.type}-${uuid()}`);
        this._STATE.planStore.set(key, newPlan);
        return key;
    }
    /**
     * 添加待爬取链接到队列，并指定爬取计划。
     * @param planKey 指定的爬取计划
     * @param url 待爬取的链接（们）
     * @param special （可选）针对当前链接的特别设置，将覆盖与plan重复的设置
     */
    queue(planKey, url, special) {
        // 参数检验
        if (typeof planKey !== "symbol") {
            throw new TypeError("queue 参数错误");
        }
        // 确定添加到哪个队列(crawlQueue还是downloadQueue?)
        let toCrawl = null; // True代表addCrawl，False代表addDownload
        if (this._STATE.planStore.has(planKey)) {
            toCrawl = true;
        }
        else if (this._STATE.dlPlanStore.has(planKey)) {
            toCrawl = false;
        }
        else {
            throw new RangeError("plan 不存在");
        }
        // 添加到队列
        // TODO C 完善 special: 过滤掉其中不相干的成员？
        if (!Array.isArray(url)) {
            if (toCrawl) {
                this._STATE.queue.addTask({ url, planKey, special });
            }
            else {
                this._STATE.queue.addDownload({ url, planKey, special });
            }
        }
        else {
            url.map((u) => {
                if (typeof u !== "string") {
                    return new Error("url数组中存在非字符串成员");
                }
                if (toCrawl) {
                    this._STATE.queue.addTask({ url: u, planKey });
                }
                else {
                    this._STATE.queue.addDownload({ url: u, planKey });
                }
            });
        }
        this._STATE.working = true;
        return [
            this._STATE.queue.getWaitingTaskNum(),
            this._STATE.queue.getWaitingDownloadTaskNum(),
            this._STATE.queue.getWaitingTaskNum(),
            this._STATE.queue.getTotalUrlsNum(),
        ];
    }
    // 关于pipeGenerator
    // 提供 add、close、init
    // 当第一次被save调用时，先触发init后再add（这样就不会生成空文件）
    // 爬虫生命周期末尾，自动调用close清理工作
    pipe(pipeObject) {
        if (typeof pipeObject !== "object" || !pipeObject.add || !pipeObject.close) {
            throw new Error("不符合pipe");
        }
        const key = Symbol("pipe-" + uuid());
        this._STATE.pipeStore.set(key, pipeObject);
        return key;
    }
    // item可以是字符串路径，也可以是对象。若字符串则保存为 txt 或json
    // 如果是对象，则获得对象的 header 属性并对要保存路径进行检测。通过则调用对象 add 方法。
    // 每一个人都可以开发 table 对象的生成器。只需要提供 header 和 add 接口。其他由开发者考虑如何完成。
    save(pipeKey, data) {
        const pipe = this._STATE.pipeStore.get(pipeKey);
        if (pipe) {
            pipe.add(data);
        }
        else {
            return new Error("unknowed pipe");
        }
    }
}
NodeSpider.Queue = queue_1.default;
exports.default = NodeSpider;
function startCrawl(self) {
    if (self._STATE.queue.getWaitingTaskNum() !== 0) {
        const task = self._STATE.queue.nextCrawlTask();
        self._STATE.currentMultiTask++;
        const plan = self._STATE.planStore.get(task.planKey);
        if (!plan) {
            throw new Error("planKey 对应的 plan 不存在");
        }
        const specialOpts = Object.assign({}, plan.options, task.special);
        const t = Object.assign({}, task, { specialOpts });
        plan.process(t, self).then(() => {
            self._STATE.currentMultiTask--;
        }).catch((e) => {
            console.log(e);
            self._STATE.currentMultiTask--;
        });
    }
}
function startDownload(self) {
    if (self._STATE.queue.getWaitingDownloadTaskNum() !== 0) {
        const task = self._STATE.queue.nextDownloadTask();
        self._STATE.currentMultiDownload++;
        // 【【这里的错误处理思想】】
        // 所有可能的错误，应该交给开发者编写的plan来处理
        // 比如在rule中处理错误，或者是在handleError中处理
        // 所以此处catch的错误，必须要再额外处理，只需要触发终止当前任务的事件即可
        _asyncDownload(task, self)
            .then(() => {
            self._STATE.currentMultiDownload--;
        })
            .catch((e) => {
            console.log(e);
            self._STATE.currentMultiDownload--;
        });
    }
}
