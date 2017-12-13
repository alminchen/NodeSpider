"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("fs-extra");
function csvPipe(path) {
    const pipe = fs.createWriteStream(path);
    pipe.format = csvFormat;
    return pipe;
}
exports.csvPipe = csvPipe;
const csvFormat = (() => {
    let isFirst = true;
    return (items) => {
        let chunk = "";
        if (isFirst) {
            isFirst = false;
            chunk += entries(items)[0].join(",") + ",\n";
        }
        chunk += entries(items)[1].join(",") + ",\n";
        return chunk;
    };
})();
function txtPipe(path) {
    const pipe = fs.createWriteStream(path);
    pipe.format = txtFormat;
    return pipe;
}
exports.txtPipe = txtPipe;
const txtFormat = (() => {
    let isFirst = true;
    return (items) => {
        let chunk = "";
        if (isFirst) {
            isFirst = false;
            chunk += entries(items)[0].join("\t") + "\n";
        }
        chunk += entries(items)[1].join("\t") + "\n";
        return chunk;
    };
})();
function jsonPipe(path) {
    const pipe = fs.createWriteStream(path);
    pipe.format = jsonFormat;
    const streamClose = pipe.close;
    pipe.close = () => {
        pipe.write("\n]");
        streamClose.call(pipe);
    };
    return pipe;
}
exports.jsonPipe = jsonPipe;
const jsonFormat = (() => {
    let first = true;
    return (items) => {
        let chunk = "";
        if (first) {
            first = false;
            chunk += "[\n";
        }
        else {
            chunk = ",\n";
        }
        chunk += JSON.stringify(items);
        return chunk;
    };
})();
// export interface IVsvPipeOption {
//     path: string;
//     header: {[index: string]: (v: string) => string};
// }
// class VsvPipe {
//     /**
//      * Creates an instance of csv pipe.
//      * @param {string} path 写入文件路径
//      * @memberOf TxtTable
//      */
//     public header: {[index: string]: (v: string) => string};
//     private stream: any;
//     constructor(opts: ICsvPipeOption) {
//         const { path, header} = opts;
//         if (typeof path !== "string") {
//             throw new Error('the string-typed parameter "path" is required');
//         }
//         fs.ensureFile(path, (err: Error) => {
//             if (err) {
//                 throw err;
//             }
//             this.header = header;
//             this.stream = fs.createWriteStream(path);
//             // 写入表头字段
//             let chunk = "";
//             for (const item in this.header) {
//                 if (this.header.hasOwnProperty(item)) {
//                     if (chunk !== "") {
//                         chunk += ",";
//                     }
//                     chunk += item;
//                 }
//             }
//             chunk += "\n";
//             this.stream.write(chunk);
//         });
//     }
//     /**
//      * 根据表头写入新数据
//      * @param {Object} data
//      */
//     public write(data: any) {
//         // 按顺序写入符合关键字段的数据并作对应的处理，不存在于关键字列表的数据将被无视
//         let chunk = "";
//         for (const item in this.header) {
//             if (this.header.hasOwnProperty(item)) {
//                 if (chunk !== "") {
//                     chunk += ",";
//                 }
//                 chunk += this.header[item](data[item]);
//             }
//         }
//         chunk += "\n";
//         this.stream.write(chunk);
//     }
//     // TODO: 调用 close 将关闭写入流，如果流中还有未写完的内容，将导致内容遗失。
//     // 解决思路：监听流的事件（如 drain）并记录为类的成员，close 中判断信号成员来决定何时关闭流
//     public close() {
//         this.stream.close();
//     }
// }
// export default function csvPipe(opts: ICsvPipeOption): IPipe {
//     return new CsvPipe(opts);
// }
function entries(obj) {
    const keys = [];
    const values = [];
    for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
            keys.push(key);
            values.push(obj[key]);
        }
    }
    return [keys, values];
}
