'use strict'; // eslint-disable-line strict

const commander = require('commander');
const fs = require('fs');
const readline = require('readline');
const spawn = require('child_process').spawn;
const stderr = process.stderr;

const s3Config = require('./config').config;

const S3Blaster = require('./s3blaster');
const reqsString = S3Blaster.requestsString.reqs;
const servers = S3Blaster.ssm.servers;
const ssmTypes = S3Blaster.ssm.ssmTypes;
const ssmTypesObj = S3Blaster.ssm.ssmTypesObj;
const nbStatsPerServer = S3Blaster.ssm.nbStatsPerServer;
const outputGraph = S3Blaster.outputGraph;
/*
graphs = {
    avgStd: avgStdGraph,
    pdfCdf: pdfCdfGraph,
    statSize: statSizeGraph,
    thread: threadGraph,
    live: liveGraph,
    final: finalGraph,
};
*/
const graphs = S3Blaster.graphs;

/*
objFromS3blaster = {
    config: {},     // configuration info
    requests: [],   // array of simulated requests
    threads: [],    // array of #parallel requests
    sizes: [],      // array of object sizes
    percentiles: [],    // array of percentiles
    message: '',    // specified message shown in graphs
    results: [],    // perf stats results
    resultsName: [],    // name of perf
    runTime: '',    // total elapsed time of program
    allRealTimeFiles: [],   // files containing real-time perf of all workers
    procNames: [],  // name of running processes
    arrDataFiles: [],   // array of stats data files
};
*/
const objFromS3blaster = S3Blaster.objToPlotter;

const KB = 1024;
const MB = KB * KB;
const GB = KB * MB;



function convertSize(size) {
    if (size < KB) {
        return `${size}B`;
    } else if (size < MB) {
        return `${size / KB}KB`;
    } else if (size < GB) {
        return `${size / MB}MB`;
    }
    return `${size / GB}GB`;
}

function getArrOfString(arr) {
    if (arr !== undefined && Array.isArray(arr)) {
        if (arr.every(dataFile => typeof dataFile === 'string')) {
            return arr.slice();
        }
    }
    return undefined;
}

class Plotter {
    constructor() {
        const gnuExt = '.gnu';
        // get config infos from s3blaster
        this.config = objFromS3blaster.config;
        this.reqsToTest = objFromS3blaster.requests;
        this.sizes = objFromS3blaster.sizes;
        this.threads = objFromS3blaster.threads;
        this.percentiles = objFromS3blaster.percentiles;
        this.fitPlot = objFromS3blaster.fitPlot;
        // get message from s3. Note, message will be shown on graphs, hence
        // '\n#' must be replaced by '\\n'
        this.message =
            objFromS3blaster.message.replace(/\n#/g, '\\n').replace(/#/g, '');
        this.results = objFromS3blaster.results;
        this.resultsName = objFromS3blaster.resultsName;
        this.allRealTimeFiles = objFromS3blaster.allRealTimeFiles.slice();
        this.procNames = objFromS3blaster.procNames;
        this.outputType = objFromS3blaster.outputType;

        let outputExt = '';
        if (this.outputType === outputGraph.PNG) {
            this.terminalType = 'pngcairo';
            outputExt = '.png';
            this.graphSize = [1280, 720]; // in pixels of HDV resolution
        } else {
            this.terminalType = 'pdfcairo';
            outputExt = '.pdf';
            this.graphSize = [17, 11]; // in inches of A4 paper
        }

        const _fileName = this.config.prefixName || 'output';
        this.gnuFile = `${_fileName}_stats${gnuExt}`;
        this.outputFile = `${_fileName}_stats${outputExt}`;
        this.gnuSizeFile = `${_fileName}_size${gnuExt}`;
        this.outputSizeFile = `${_fileName}_size${outputExt}`;
        this.gnuPdfCdf = [`${_fileName}_pdf${gnuExt}`,
                          `${_fileName}_cdf${gnuExt}`];
        this.outputPdfCdf = [`${_fileName}_pdf${outputExt}`,
                            `${_fileName}_cdf${outputExt}`];
        this.gnuThreadFile = `${_fileName}_thread${gnuExt}`;
        this.outputThreadFile = `${_fileName}_thread${outputExt}`;
        this.gnuLiveFile = `${_fileName}_live${gnuExt}`;
        this.outputLiveFile = `${_fileName}_live${outputExt}`;
        this.gnuFinalFile = `${_fileName}_summary${gnuExt}`;
        this.outputFinalFile = `${_fileName}_summary${outputExt}`;

        this.graphsToPlot = [];
        this.createGnuFuncs = [];
        this.gnuFilesToPlot = [];

        // for workers
        if (objFromS3blaster.arrDataFiles.length > 0) {
            this.dataFile = objFromS3blaster.arrDataFiles[0];
            this.funcFiles = getArrOfString(objFromS3blaster.arrDataFiles[1]);
            this.threadFile = objFromS3blaster.arrDataFiles[2];
            this.liveFile = objFromS3blaster.arrDataFiles[3];
            if (this.dataFile === undefined) {
                stderr.write('missing data files for Plotter\n');
                return;
            }
            if (this.funcFiles === undefined) {
                stderr.write('missing pdf/cdf files for Plotter\n');
                return;
            }
            if (this.threadFile === undefined) {
                stderr.write('missing thread file for Plotter\n');
                return;
            }
            if (this.liveFile === undefined) {
                stderr.write('missing live file for Plotter\n');
                return;
            }
            this.graphsToPlot = this.graphsToPlot.concat(
                [graphs.avgStd, graphs.pdfCdf, graphs.statSize, graphs.thread]);
            this.createGnuFuncs = this.createGnuFuncs.concat(
                [this.createGnuFile, this.createGnuFilePdfCdf,
                    this.createGnuFileSize, this.createGnuFileThread]
            );
            this.gnuFilesToPlot = this.gnuFilesToPlot.concat(
                [this.gnuFile, this.gnuPdfCdf[0], this.gnuPdfCdf[1],
                    this.gnuSizeFile, this.gnuThreadFile]
            );
        }
        // plot live & final graphs
        if (objFromS3blaster.arrDataFiles[graphs.live]) {
            this.graphsToPlot.push(graphs.live);
            this.ssmFile = objFromS3blaster.arrDataFiles[graphs.live];
            this.createGnuFuncs.push(this.createGnuFileLive);
            this.gnuFilesToPlot.push(this.gnuLiveFile);
        }
        this.paramsForThreadPlot = undefined;
        if (objFromS3blaster.arrDataFiles[graphs.final]) {
            this.graphsToPlot.push(graphs.final);
            this.finalFile = objFromS3blaster.arrDataFiles[graphs.final];
            this.createGnuFuncs.push(this.createGnuFileThread);
            this.gnuFilesToPlot.push(this.gnuFinalFile);

            this.paramsForThreadPlot = {
                inputFile: this.finalFile,
                gnuFile: this.gnuFinalFile,
                outputFile: this.outputFinalFile,
                stdDevPlot: 'dontPlot',
            };
        }

        this.stats = {
            nOps: 0,
            min: [],
            max: [],
            mu: [],
            sigma: [],
        };

        commander.version('0.0.1')
        .option('--ssm', 'Enable ssh-system-monitor')
        .parse(process.argv);
        this.ssm = commander.ssm || s3Config.simul.ssm || false;
        this.liveGlobal =
            commander.liveGlobal || s3Config.simul.liveGlobal || false;
    }

    genLegend() {
        return `${new Date()}\\n${this.message}\\n`;
    }

    genTerminal(nbX, nbY, ratio) {
        let width = this.graphSize[0];
        let height = this.graphSize[1];
        if (ratio) {
            width *= ratio[0];
            height *= ratio[1];
        }
        return `${this.terminalType} size ${width * nbX},${height * nbY} `;
    }

    /**
     * function get configuration info from stats files
     * @param {string} dataFile: path to stats file
     * @param {function} cb: callback function
     * @return {function} callback function
     */
    getConfigInfo(dataFile, cb) {
        const rl = readline.createInterface({
            input: fs.createReadStream(dataFile),
            terminal: true,
        });
        rl.on('line', line => {
            const arr = line.toString().split(' ');
            if (arr[1] === 'nOps') {
                this.stats.nOps = parseInt(arr[2], 10);
            }
            if (arr[1] === 'min') {
                this.stats.min = arr.slice(2);
            }
            if (arr[1] === 'max') {
                this.stats.max = arr.slice(2);
            }
            if (arr[1] === 'mu') {
                this.stats.mu = arr.slice(2);
            }
            if (arr[1] === 'sigma') {
                this.stats.sigma = arr.slice(2);
            }
            if (arr[1] === 'End_configuration') {
                rl.close();
            }
        }).on('close', () => cb());
    }

    /**
     * function creates .gnu command to plot data on columns of a data file
     * @param {string} file: data file name
     * @param {array} cols: [col1, col2, col3]
     * @param {array} every: [firstLine, step, lastLine]
     * @param {string} title: curve title
     * @param {string} type: 'lines' or 'points' or 'linespoints'
     * @param {number} color: curve color
     * @param {boolean} next: fasle -> last line
     * @param {number} pt: curve point type
     * @param {number} lw: curve line weight
     * @param {array} fit: [func, title] for fit
     * @param {array} axes: axes for curve,
     *          if relevant axes[0] = 'x1y1' or 'x2y2'
     *                      axes[1] = ',' or null
     * @return {this} this
     */
    plotLine(file, cols, every, title, type, color, next, pt, lw, fit, axes) {
        const _type = type || 'linespoints';
        const _lt = 1;
        const _lw = lw || 2;
        const _pt = pt || color;
        let str;

        let _title;
        if (title) {
            _title = `title '${title}'`;
        } else {
            _title = 'notitle';
        }

        let _every = '';
        if (every) {
            if (every.length === 2) {
                _every = `every ${every[1]}::${every[0]} `;
            } else if (every.length === 3) {
                _every = `every ::${every[0]}::${every[2]} `;
            }
        }

        str = `"${file}" ${_every} u ${cols[0]}:${cols[1]} ` +
                `${_title} w ${_type} lc ${color} lt ${_lt} lw ${_lw}`;
        if (type === 'points' || type === 'linespoints') {
            str += ` pt ${_pt}`;
        }
        if (cols[2]) {
            str += `, "${file}" ${_every} u ${cols[0]}:${cols[1]}:${cols[2]} ` +
                `notitle w yerrorbars lc ${color} lt ${_lt} lw 1`;
            if (type === 'points' || type === 'linespoints') {
                str += ` pt ${_pt}`;
            }
        }

        if (axes) {
            str += ` axes ${axes[0]}`;
        }

        if (fit) {
            str += `,\ ${fit[0]} title ${fit[1]}`;
        }

        if (axes && axes[1]) {
            str += `${axes[1]}`;
        }

        if (next) {
            str += ',\\';
        }

        if (!axes || !axes[1]) {
            str += `\n`;
        }

        return str;
    }

    /**
    * function creates .gnu files that plots graphs for average and
    *  standard deviation, and percentiles of request latency.
    * @param {function} cb: callback function
    * @return {function} callback
     */
    createGnuFile(cb) {
        let percFlag;
        function genGnuPerThread(thread, threadIdx) {
            const nbX = this.reqsToTest.length;
            const nbY = this.sizes.length;

            const layout = `${nbY},${nbX}`;
                /* plot multiple graphs
                 *   -> each request type per column
                 *   -> each graph per object size
                 */
            let content =
                `set multiplot layout ${layout} columnsfirst ` +
                'title "Average, standard-deviation ';
            if (percFlag) {
                content += 'and percentiles';
            }
            content += `vs. #successes\\n${this.genLegend()}"\n` +
                `set style data linespoints\n`;
            content += `set xlabel 'Number of successes'\n`;
            content += `set grid xtics ytics\n` +
                `set key top left Left reverse box width 3 height 1.5\n`;
            let xCol = 1;
            let yCol = 3;   // second column is #threads
            this.reqsToTest.forEach((req, reqIdx) => {
                this.sizes.forEach((size, sizeIdx) => {
                    const res = objFromS3blaster.results;
                    let title = `${reqsString[req]}; ` +
                    'latency (ms): ' +
                    `avg ${res[req][threadIdx][sizeIdx][1]}, ` +
                    `std-dev ${res[req][threadIdx][sizeIdx][2]}, `;
                    if (this.percentiles) {
                        title += 'percentiles';
                        this.percentiles.forEach((perc, percIdx) => {
                            title += ` ${perc * 100}%: ` +
                                `${res[req][threadIdx][sizeIdx][5 + percIdx]},`;
                        });
                    }
                    title += ' average #operations/s: ' +
                        `${res[req][threadIdx][sizeIdx][4]}`;
                    let color = 1;
                    content += `unset title; set title '${title}'\n`;
                    if (reqIdx === 0) {
                        content += 'set ylabel "Latency (ms), ' +
                                   `size = ${convertSize(size)}"\n`;
                    }
                    if (reqIdx === 1) {
                        content += 'unset ylabel\n';
                    }
                    content += 'plot ';
                    content += this.plotLine(this.dataFile,
                        [`(($${xCol + 1}==${thread}) ? $${xCol} : 1/0)`,
                            yCol, yCol + 1],
                        null, 'avg, std-dev', 'linespoints', color, true,
                        null, 3);
                    color++;
                    yCol += 2;
                    if (percFlag) {
                        this.percentiles.forEach((perc, percIdx) => {
                            content += this.plotLine(this.dataFile,
                                [`(($${xCol + 1}==${thread}) ? $${xCol} : 1/0)`,
                                    yCol], null,
                                `Percentile ${perc * 100}%`,
                                'linespoints', color,
                                (percIdx !== this.percentiles.length - 1),
                                null, 1);
                            color++;
                            yCol++;
                        });
                    }
                    xCol = yCol;
                    yCol += 2;
                    content += `\n`;
                });
            });
            return content;
        }
        function genGnuFile(genCb) {
            const nbX = this.reqsToTest.length;
            const nbY = this.sizes.length;

            let content =
                `set terminal ${this.genTerminal(nbX, nbY)} ` +
                    `enhanced color font "CMR14, 20"\n` +
                `set output '${this.outputFile}'\n`;
                /* plot multiple graphs
                 *   -> each page per a number of parallel requests
                 */
            this.threads.forEach((thread, threadIdx) => {
                content += genGnuPerThread.bind(this)(thread, threadIdx);
            });
            content += `unset multiplot; set output\n`;
            fs.writeFile(this.gnuFile, content, err => genCb(err));
        }

        this.getConfigInfo(this.dataFile, err => {
            if (err) return cb(err);
            percFlag = (this.percentiles.length > 0);
            return genGnuFile.bind(this)(cb);
        });
    }

    /**
    * function creates .gnu files that plots graphs for request
    *  latency and #operations/s vs. data sizes
     * There are two metrics to be plotted:
     *  - Average (and standard-deviabtion) request latency
     *  - Average number of operations/second
     * @param {function} cb: callback function
     * @return {function} callback
     */
    createGnuFileSize(cb) {
        let unit;
        let unitString;

        function genGnuFile(genCb) {
            let xtics;
            let mxtics;
            const maxSize =
                        Math.floor(this.sizes[this.sizes.length - 1] / unit);
            const minSize = Math.ceil(this.sizes[0] / unit);
            const xticsNb = Math.min(this.threads.length, 10);
            if (this.sizes.length > 4) {
                xtics = Math.max(Math.floor((maxSize - minSize) / xticsNb), 1);
                mxtics = 1;
            }
            let color = 1;
            let col = 3; // the two first columns are #threads and data sizes
            let firstLine;
            let lastLine;
            /* In each graph, different curves for different #threads */
            let nbX = this.reqsToTest.length;
            let nbY = 2;
            let layout = `${nbY},${nbX}`;
            let content =
                `set terminal ${this.genTerminal(nbX, nbY)}` +
                    `enhanced color font "CMR14, 20"\n` +
                `set output '${this.outputSizeFile}'\n` +
                `set key top left Left reverse box width 3 height 1.5\n` +
                /* plot multiple graphs
                 *   -> graphs on 1st row for latency
                 *   -> graphs on 2nd row for #operations/s
                 */
                `set multiplot layout ${layout} columnsfirst ` +
                    'title "Request latency and #operations/s vs. ' +
                    'object sizes\\n' +
                    'in each graph, each curve corrsponds to one number of ' +
                    'parallel requests\\n' +
                    ` ${this.genLegend()}"\n` +
                `set style data linespoints\n`;
            if (this.sizes.length > 4) {
                content += `set xtics ${xtics}; set mxtics ${mxtics}\n`;
            }
            content += `set grid xtics mxtics ytics\n`;
            /* Global for all #threads */
            this.reqsToTest.forEach((req, reqIdx) => {
                let colorp = color;
                firstLine = 0;
                lastLine = this.sizes.length - 1;
                /* Request latency for all data sizes */
                if (reqIdx === 0) {
                    content += `set ylabel 'Request latency (ms)'\n`;
                }
                content += 'plot ';
                this.threads.forEach((thread, idx) => {
                    const title = `${reqsString[req]}, ` +
                        `#parallel requests = ${thread}`;
                    content += this.plotLine(this.threadFile,
                        [`($2/${unit})`, col, col + 1],
                        [firstLine, null, lastLine], title,
                        'linespoints', colorp,
                        (idx < this.threads.length - 1));
                    colorp++;
                    firstLine += this.sizes.length;
                    lastLine += this.sizes.length;
                });
                /* Number of operations/s for all data sizes */
                firstLine = 0;
                lastLine = this.sizes.length - 1;
                if (reqIdx === 0) {
                    content += `unset ylabel\n` +
                               `set ylabel 'Average number of operations/s'\n`;
                }
                content += `set xlabel 'Object sizes (${unitString})'\n`;
                content += 'plot ';
                this.threads.forEach((thread, idx) => {
                    const title = `${reqsString[req]}, ` +
                        `#parallel requests = ${thread}`;
                    content += this.plotLine(this.threadFile,
                        [`($2/${unit})`, col + 2],
                        [firstLine, null, lastLine], title,
                        'linespoints', colorp,
                        (idx < this.threads.length - 1));
                    colorp++;
                    firstLine += this.sizes.length;
                    lastLine += this.sizes.length;
                });
                content += `\n`;
                if (reqIdx === 0) {
                    content += `unset ylabel\n`;
                }
                content += `unset xlabel\n`;
                col += 3;
                color = colorp;
            });
            /* #operations/s: only one curve/graph for one #threads */
            nbX = this.reqsToTest.length;
            nbY = this.threads.length;
            layout = `${nbY},${nbX}`;
            color = 1;
            col = 5;
            content +=
                `set key top left Left reverse box width 3 height 1.5\n` +
                /* plot multiple graphs
                 *   -> graphs on a column correspond to a request
                 *   -> graphs on a row correspond to one #threads
                 */
                `set multiplot layout ${layout} columnsfirst ` +
                    'title "#operations/s vs. object sizes\\n' +
                    'only one curve/graph corrsponds to one object size\\n' +
                    ` ${this.genLegend()}"\n` +
                `set style data linespoints\n`;
            if (this.sizes.length > 4) {
                content += `set xtics ${xtics}; set mxtics ${mxtics}\n`;
            }
            content += `set grid xtics mxtics ytics\n`;
            this.reqsToTest.forEach((req, reqIdx) => {
                let colorp = color;
                colorp = color;
                firstLine = 0;
                lastLine = this.sizes.length - 1;
                content += `\n`;
                if (reqIdx === 0) {
                    content = `${content}` +
                        `unset ylabel\n` +
                        `set ylabel 'Average number of operations/s'\n`;
                }
                this.threads.forEach((thread, threadIdx) => {
                    if (threadIdx === this.threads.length - 1) {
                        content +=
                            `set xlabel 'Object sizes (${unitString})'\n`;
                    }
                    const title = `${reqsString[req]}, ` +
                        `#parallel requests: ${thread}`;
                    content += 'plot ';
                    content += this.plotLine(this.threadFile,
                        [`($2/${unit})`, col],
                        [firstLine, null, lastLine], title,
                        'linespoints', color, null, null, 1);
                    color++;
                    firstLine += this.sizes.length;
                    lastLine += this.sizes.length;
                });
                if (reqIdx === 0) {
                    content += `unset ylabel\n`;
                }
                content += `unset xlabel\n`;
                col += 3;
                color = colorp;
            });
            /* request latency: only one curve/graph for one #threads */
            nbX = this.reqsToTest.length;
            nbY = this.threads.length;
            layout = `${nbY},${nbX}`;
            color = 1;
            col = 3;
            content +=
                `set key top left Left reverse box width 3 height 1.5\n` +
                /* plot multiple graphs
                 *   -> graphs on a column correspond to a request
                 *   -> graphs on a row correspond to a data size
                 */
                `set multiplot layout ${layout} columnsfirst ` +
                    'title "Request latency vs. object sizes\\n' +
                    'only one curve/graph corrsponds to one number of ' +
                    'parallel request\\n' +
                    ` ${this.genLegend()}"\n` +
                `set style data linespoints\n`;
            if (this.sizes.length > 4) {
                content += `set xtics ${xtics}; set mxtics ${mxtics}\n`;
            }
            content += `set grid xtics mxtics ytics\n`;
            this.reqsToTest.forEach((req, reqIdx) => {
                let colorp = color;
                let firstLine = 0;
                firstLine = 0;
                lastLine = this.sizes.length - 1;
                colorp = color;
                content += `\n`;
                if (reqIdx === 0) {
                    content += `unset ylabel\n` +
                                `set ylabel 'Average request latency (ms)'\n`;
                }
                this.threads.forEach((thread, threadIdx) => {
                    if (threadIdx === this.threads.length - 1) {
                        content +=
                            `set xlabel 'Object sizes (${unitString})'\n`;
                    }
                    const title = `${reqsString[req]}, ` +
                        `#parallel requests = ${thread}`;
                    content += 'plot ';
                    content += this.plotLine(this.threadFile,
                        [`($2/${unit})`, col],
                        [firstLine, null, lastLine], title,
                        'linespoints', color, null, null, 1);
                    color++;
                    firstLine += this.sizes.length;
                    lastLine += this.sizes.length;
                });
                if (reqIdx === 0) {
                    content += `unset ylabel\n`;
                }
                content += `unset xlabel\n`;
                col += 3;
                color = colorp;
            });
            content += `unset multiplot; set output\n`;
            fs.writeFile(this.gnuSizeFile, content, err => genCb(err));
        }
        this.getConfigInfo(this.threadFile, err => {
            if (err) return cb(err);
            if (this.sizes[0] < KB) {
                unit = 1;
                unitString = 'B';
            } else if (this.sizes[0] < MB) {
                unit = KB;
                unitString = 'KB';
            } else {
                unit = MB;
                unitString = 'MB';
            }
            return genGnuFile.bind(this)(cb);
        });
    }

    /**
     * function creates .gnu files that plots graphs for request
     *  latency and #operations/s vs. threads number
     * There are two metrics to be plotted:
     *  - Average (and standard-deviabtion) request latency
     *  - Average number of operations/second
     * @param {function} cb: callback function
     * @return {function} callback
     */
    createGnuFileThread(cb) {
        let inputFile = this.threadFile;
        let gnuFile = this.gnuThreadFile;
        let outputFile = this.outputThreadFile;
        let stdDevPlot = true;

        if (this.paramsForThreadPlot && this.paramsForThreadPlot.inputFile) {
            inputFile = this.paramsForThreadPlot.inputFile;
        }
        if (this.paramsForThreadPlot && this.paramsForThreadPlot.gnuFile) {
            gnuFile = this.paramsForThreadPlot.gnuFile;
        }
        if (this.paramsForThreadPlot && this.paramsForThreadPlot.outputFile) {
            outputFile = this.paramsForThreadPlot.outputFile;
        }
        if (this.paramsForThreadPlot && this.paramsForThreadPlot.stdDevPlot) {
            stdDevPlot = (this.paramsForThreadPlot.stdDevPlot !== 'dontPlot');
        }

        let xticsStr = '';
        this.threads.forEach(thr => {
            xticsStr += `"${thr}" ${thr}, `;
        });
        xticsStr = xticsStr.slice(0, xticsStr.length - 2);

        const maxThread = this.threads[this.threads.length - 1];
        const minThread = this.threads[0];
        const xticsNb = Math.min(this.threads.length, 10);

        let xtics;
        let mxtics;
        if (this.threads.length > 4) {
            xtics = Math.max(Math.floor((maxThread - minThread) / xticsNb),
                                1);
            mxtics = 1;
        }
        let color = 1;
        let col = 3; // the two first columns are #threads and data sizes
        const step = this.sizes.length;
        /* In each graph, different curves for different data sizes */
        let nbX = this.reqsToTest.length;
        let nbY = 2;
        let layout = `${nbY},${nbX}`;
        let content =
            `set terminal ${this.genTerminal(nbX, nbY)}` +
                `enhanced color font "CMR14, 20"\n` +
            `set output '${outputFile}'\n` +
            // `set logscale x\n` +
            `set xtics (${xticsStr})\n` +
            `set key top left Left reverse box width 3 height 1.5\n` +
            /* plot multiple graphs
             *   -> graphs on 1st row for latency
             *   -> graphs on 2nd row for #operations/s
             */
            `set multiplot layout ${layout} columnsfirst ` +
                'title "Request latency and #operations/s vs.' +
                ' #parallel requests\\n' +
                'in each graph, each curve corrsponds to one data size\\n' +
                ` ${this.genLegend()}"\n` +
            `set style data linespoints\n`;
        if (this.threads.length > 4) {
            content += `set xtics ${xtics}; set mxtics ${mxtics}\n`;
        }
        content += `set grid xtics mxtics ytics\n`;
        /* Global for all data sizes */
        this.reqsToTest.forEach((req, reqIdx) => {
            let colorp = color;
            let firstLine = 0;
            /* Request latency for all data sizes */
            if (reqIdx === 0) {
                content += `set ylabel 'Request latency (ms)'\n`;
            }
            content += 'plot ';
            this.sizes.forEach((size, idx) => {
                const title =
                    `${reqsString[req]}, size = ${convertSize(size)}`;
                const colsToPlot = (stdDevPlot) ? [1, col, col + 1] :
                                                  [1, col];
                content += this.plotLine(inputFile,
                    colsToPlot, [firstLine, step], title, 'linespoints',
                    colorp, (idx < this.sizes.length - 1));
                colorp++;
                firstLine++;
            });
            col = (stdDevPlot) ? col + 2 : col + 1;
            /* Number of operations/s for all data sizes */
            firstLine = 0;
            colorp = color;
            if (reqIdx === 0) {
                content += `unset ylabel\n` +
                           `set ylabel 'Average number of operations/s'\n`;
            }
            content += `set xlabel 'Number of parallel requests'\n`;
            content += 'plot ';
            this.sizes.forEach((size, idx) => {
                const title =
                    `${reqsString[req]}, size = ${convertSize(size)}`;
                content += this.plotLine(inputFile,
                    [1, col], [firstLine, step], title,
                    'linespoints', colorp, (idx < this.sizes.length - 1));
                colorp++;
                firstLine++;
            });
            col++;
            content += `\n`;
            if (reqIdx === 0) {
                content += `unset ylabel\n`;
            }
            content += `unset xlabel\n`;
        });
        /* #operations/s: only one curve/graph for one data size */
        nbX = this.reqsToTest.length;
        nbY = this.sizes.length;
        layout = `${nbY},${nbX}`;
        color = 1;
        col = (stdDevPlot) ? 5 : 4;
        content +=
            `set key top left Left reverse box width 3 height 1.5\n` +
            // `set logscale x\n` +
            `set xtics (${xticsStr})\n` +
            /* plot multiple graphs
             *   -> graphs on a column correspond to a request
             *   -> graphs on a row correspond to a data size
             */
            `set multiplot layout ${layout} columnsfirst ` +
                'title "#operations/s vs. #parallel requests\\n' +
                'only one curve/graph corrsponds to one data size\\n' +
                ` ${this.genLegend()}"\n` +
            `set style data linespoints\n`;
        if (this.threads.length > 4) {
            content += `set xtics ${xtics}; set mxtics ${mxtics}\n`;
        }
        content += `set grid xtics mxtics ytics\n`;
        this.reqsToTest.forEach((req, reqIdx) => {
            let colorp = color;
            let firstLine = 0;
            firstLine = 0;
            colorp = color;
            content += `\n`;
            if (reqIdx === 0) {
                content = `${content}` +
                    `unset ylabel\n` +
                    `set ylabel 'Average number of operations/s'\n`;
            }
            if (this.fitPlot && this.threads.length > 4) {
                content = `${content}` +
                    `a=1; b=1; c=1; d=1\n` +
                    `FIT_MAXITER = 1\n` +
                    `f(x) = a + b / (c*x + d)\n`;
                content += 'g(x) = a\n';
            }
            this.sizes.forEach((size, sizeIdx) => {
                if (sizeIdx === this.sizes.length - 1) {
                    content += `set xlabel 'Number of parallel requests'\n`;
                }
                const title =
                    `${reqsString[req]}, size = ${convertSize(size)}`;
                if (this.fitPlot && this.threads.length > 4) {
                    content +=
                        `fit g(x) "${inputFile}" ` +
                            `every ${step}::${firstLine} u 1:${col} ` +
                            `via a,b,c,d\n` +
                        'ti = sprintf("Estimation ' +
                            `y = %.2f+(%.2f)/(%.2fx+%.2f)", a, b, c, d)\n`;
                    content +=
                        `thres = sprintf("%.2f ", a)\n`;
                }
                content += 'plot ';
                if (this.fitPlot && this.threads.length > 4) {
                    content += this.plotLine(inputFile,
                        [1, col], [firstLine, step], title,
                        'linespoints', color, null, null, 1,
                        ['g(x)', 'thres']);
                } else {
                    content += this.plotLine(inputFile,
                        [1, col], [firstLine, step], title,
                        'linespoints', color, null, null, 1);
                }
                color++;
                firstLine++;
            });
            if (reqIdx === 0) {
                content += `unset ylabel\n`;
            }
            content += `unset xlabel\n`;
            col = (stdDevPlot) ? col + 3 : col + 2;
            color = colorp;
        });
        /* request latency: only one curve/graph for one data size */
        nbX = this.reqsToTest.length;
        nbY = this.sizes.length;
        layout = `${nbY},${nbX}`;
        color = 1;
        col = 3;
        content +=
            `set key top left Left reverse box width 3 height 1.5\n` +
            // `set logscale x\n` +
            `set xtics (${xticsStr})\n` +
            /* plot multiple graphs
             *   -> graphs on a column correspond to a request
             *   -> graphs on a row correspond to a data size
             */
            `set multiplot layout ${layout} columnsfirst ` +
                'title "Request latency vs. #parallel requests\\n' +
                'only one curve/graph corrsponds to one data size\\n' +
                ` ${this.genLegend()}"\n` +
            `set style data linespoints\n`;
        if (this.threads.length > 4) {
            content += `set xtics ${xtics}; set mxtics ${mxtics}\n`;
        }
        content += `set grid xtics mxtics ytics\n`;
        this.reqsToTest.forEach((req, reqIdx) => {
            let colorp = color;
            let firstLine = 0;
            firstLine = 0;
            colorp = color;
            content += `\n`;
            if (reqIdx === 0) {
                content += `unset ylabel\n` +
                            `set ylabel 'Average request latency (ms)'\n`;
            }
            if (this.fitPlot && this.threads.length > 4) {
                content = `${content}` +
                    `a=1; b=1;\n` +
                    `FIT_MAXITER = 1\n` +
                    `h(x) = a*x + b\n`;
            }
            this.sizes.forEach((size, sizeIdx) => {
                if (sizeIdx === this.sizes.length - 1) {
                    content += `set xlabel 'Number of parallel requests'\n`;
                }
                const title =
                    `${reqsString[req]}, size = ${convertSize(size)}`;
                if (this.fitPlot && this.threads.length > 4) {
                    content +=
                        `fit h(x) "${inputFile}" ` +
                        `every ${step}::${firstLine} u 1:${col} via a,b\n` +
                        'ti = sprintf("Estimation y = %.2fx+%.2f", a, b)\n';
                }
                content += 'plot ';
                if (this.fitPlot && this.threads.length > 4) {
                    content += this.plotLine(inputFile,
                        [1, col], [firstLine, step], title,
                        'linespoints', color, null, null, 1,
                        ['h(x)', 'ti']);
                } else {
                    content += this.plotLine(inputFile,
                        [1, col], [firstLine, step], title,
                        'linespoints', color, null, null, 1);
                }
                color++;
                firstLine++;
            });
            if (reqIdx === 0) {
                content += `unset ylabel\n`;
            }
            content += `unset xlabel\n`;
            col = (stdDevPlot) ? col + 3 : col + 2;
            color = colorp;
        });
        content += `unset multiplot; set output\n`;
        fs.writeFile(gnuFile, content, cb);
    }

    /**
     * function creates .gnu files that plots graphs of estimated
     *  pdf & cdf
     * @param {function} cb: callback function
     * @return {function} callback
     */
    createGnuFilePdfCdf(cb) {
        function genGnuFile(genCb) {
            const yLabel = ['Probability distribution function',
                            'Cumulative distribution function'];
            const nbX = this.reqsToTest.length;
            const nbY = this.sizes.length;
            const layout = `${nbY},${nbX}`;
            let count = 0;
            this.funcFiles.forEach((dataFile, fileIdx) => {
                let content =
                    `set terminal ${this.genTerminal(nbX, nbY)} ` +
                        `enhanced color font "CMR14, 20"\n` +
                    `set output '${this.outputPdfCdf[fileIdx]}'\n` +
                    `set style data lines\n` +
                    `set grid xtics, ytics, mytics, mxtics\n`;
                /* plot multiple graphs
                 *   -> graphs on a column correspond to a request
                 *   -> graphs on a row correspond to a data size
                 */
                content +=
                    `set multiplot layout ${layout} ` +
                    `rowsfirst title "${yLabel[fileIdx]}\\n` +
                        `${this.genLegend()}"\n`;
                let color = 1;
                let col = 2;
                this.sizes.forEach((size, idx) => {
                    content += `set ylabel "size = ${convertSize(size)}"\n`;
                    if (idx === this.sizes.length - 1) {
                        content += `set xlabel 'Latency (ms)'\n`;
                    }
                    this.reqsToTest.forEach((reqIdx, idxp) => {
                        if (idx === 0) {
                            content +=
                                `set title '${reqsString[reqIdx]}'\n`;
                        }
                        content +=
                            'set label ' +
                                `"avg = ${this.stats.mu[col - 2]}\\n` +
                                `std-dev = ${this.stats.sigma[col - 2]}" ` +
                                `at graph 0.8, graph 0.9 \n` +
                            `plot "${dataFile}" u ${1}:${col} ` +
                            `notitle lc ${color} lt 1 lw 1\n` +
                            `unset label\n`;
                        if (idxp === 0) {
                            content += `unset ylabel\n`;
                        }
                        col ++;
                        color++;
                    });
                    if (idx === 0) {
                        content += `unset title\n`;
                    }
                    if (idx === this.sizes.length - 1) {
                        content += `unset xlabel\n`;
                    }
                });
                /* plot multiple graphs: each graph on a row correspond to a
                 *   request with all data sizes
                 */
                color = 1;
                content += `set xlabel 'Latency (ms)'\n`;
                content += `set multiplot layout ${this.reqsToTest.length},1 ` +
                           `rowsfirst title "${yLabel[fileIdx]}, ` +
                           `all sizes"\n`;
                this.reqsToTest.forEach((reqIdx, idxp) => {
                    col = 2 + idxp;
                    content += `set ylabel '${reqsString[reqIdx]}'\n`;
                    content += 'plot ';
                    this.sizes.forEach((size, idx) => {
                        content +=
                            `"${dataFile}" u ${1}:${col} ` +
                            `title 'size = ${convertSize(size)}' ` +
                            `lc ${color} lt 1 lw 1`;
                        if (idx < this.sizes.length - 1) {
                            content += ',\\';
                        }
                        content += `\n`;
                        col += this.reqsToTest.length;
                        color++;
                    });
                    content += `unset ylabel\n`;
                });
                content += `unset multiplot; set output\n`;
                fs.writeFile(this.gnuPdfCdf[fileIdx], content,
                    err => { // eslint-disable-line
                        if (err) {
                            return genCb(err);
                        }
                        count += 1;
                        if (count === this.funcFiles.length) {
                            return genCb();
                        }
                    });
            });
        }
        this.getConfigInfo(this.funcFiles[0], err => {
            if (err) return cb(err);
            return genGnuFile.bind(this)(cb);
        });
    }

    /**
     * function creates .gnu files that plots graphs for ssm and live stats
     * @param {function} cb: callback function
     * @return {function} callback
     */
    createGnuFileLive(cb) {
        if (!this.ssm) {
            cb(); return;
        }
        /* In each graph, different curves for different data sizes */
        const nbX = 1;
        let nbY = this.reqsToTest.length * this.procNames.length;
        if (this.ssm) {
            nbY += nbStatsPerServer;
        }
        const layout = `${nbY},${nbX}`;
        let content =
            `set terminal ${this.genTerminal(nbX, nbY, [1, 0.5])} ` +
                `enhanced color font "CMR14, 20"\n` +
            `set output '${this.outputLiveFile}'\n` +
            /* plot multiple graphs
             *   -> perfs are shown on top, each for one request
             *   -> servers stats are shown on bottom, each for one type
             */
            `set multiplot layout ${layout} columnsfirst ` +
                'title "Servers states and perf.\\n' +
                ` ${this.genLegend()}"\n` +
            `set xrange [0:${Number(objFromS3blaster.runTime)}]\n` +
            `set x2range [0:${Number(objFromS3blaster.runTime)}]\n` +
            `set key top left Left reverse box width 3 height 1.5\n` +
            `set style data lines\n` +
            `set autoscale y; set autoscale y2\n`;
        content += `set xlabel 'Elapsed time (s)\n`;
        content += 'set ytics nomirror; set y2tics\n' +
                    `set grid xtics ytics\n`;
        let color = 1;
        let col = 2; // the first column is elapsed time

        /* plot requests latency and #ops/s for master/worker */
        this.allRealTimeFiles.forEach((workerFile, workerIdx) => {
            col = 2; // the first column is elapsed time
            content += 'unset title; set title "Performance measured by ' +
                `${this.procNames[workerIdx]} process"\n`;
            this.reqsToTest.forEach(req => {
                color = 1;
                content += 'unset ylabel; set ylabel ' +
                    `'${reqsString[req]}: average & dev latency(ms)'\n` +
                    'unset y2label; set y2label ' +
                        `'${reqsString[req]}: #operations/s'\n`;
                content += 'plot ';
                content +=
                    this.plotLine(workerFile, [1, col, col + 1],
                        null, 'latency', 'lines', color++, null, 4,
                        null, null, ['x1y1', ',']) +
                    this.plotLine(workerFile, [1, col + 2],
                        null, '#operations/s', 'lines', color, null, 6,
                        null, null, ['x2y2', '']);
                content += `\n`;
                color++;
                col += 3;
            });
        });
        content += 'unset y2label; unset title\n' +
            'set title "Processes\' resources consuming measured by ' +
            'Master process"\n';

        /* plot servers states*/
        col = 2; // the first column is elapsed time
        ssmTypes.forEach(type => {
            color = 1;
            const msg = ssmTypesObj[type];
            if (Array.isArray(msg)) {
                msg.forEach((_msg, _idx) => {
                    content += `unset ylabel; set ylabel '${_msg}'\n`;
                    content += 'plot ';
                    color = 1;
                    servers.forEach((server, idx) => {
                        const colp = col + _idx +
                                        idx * nbStatsPerServer;
                        content +=
                            this.plotLine(this.ssmFile, [1, colp],
                                null, server, 'lines', color,
                                (idx < servers.length - 1));
                        color++;
                    });
                });
                content += `\n`;
                col += 2;
            } else {
                content += 'unset ylabel; ' +
                           `set ylabel '${ssmTypesObj[type]}'\n`;
                content += 'plot ';
                servers.forEach((server, idx) => {
                    const colp = col + idx * nbStatsPerServer;
                    content += this.plotLine(this.ssmFile, [1, colp],
                        null, server, 'lines', color,
                        (idx < servers.length - 1));
                    color++;
                });
                content += `\n`;
                col++;
            }
        });

        content += `unset multiplot; set output\n`;

        fs.writeFile(this.gnuLiveFile, content, cb);
    }

    createAllGnuFiles(cb) {
        let count = 0;
        this.createGnuFuncs.forEach(createGnuFunc => {
            createGnuFunc.bind(this)(err => {
                if (err) {
                    return cb(err);
                }
                count++;
                if (count === this.graphsToPlot.length) {
                    return cb();
                }
                return undefined;
            });
        });
    }

    plotData(cb) {
        stderr.write('plotting..');
        const outGnuplot = fs.openSync('./gnuplot.log', 'a');
        const errGnuplot = fs.openSync('./gnuplot.log', 'a');

        this.createAllGnuFiles(err => {
            if (err) {
                return cb(err);
            }
            if (!this.graphsToPlot || this.graphsToPlot.length === 0) {
                return cb();
            }
            let cmd = '';
            this.gnuFilesToPlot.forEach(gnuFile => {
                cmd += `gnuplot ${gnuFile}; `;
            });

            stderr.write(`${cmd}..`);

            const gnuplot = spawn('bash', ['-c', cmd], {
                detached: true,
                stdio: ['ignore', outGnuplot, errGnuplot],
            });
            gnuplot.unref();

            gnuplot.on('exit', () => {
                stderr.write(`done\n`);
                return cb();
            });

            gnuplot.on('data', msg => {
                process.stdout.write(`gnuplot message: ${msg}\n`);
            });

            gnuplot.on('error', err => {
                stderr.write(`gnuplot error: ${err}\n`);
                return cb(err);
            });
            return undefined;
        });
    }
}

module.exports = Plotter;
