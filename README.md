# S3Blaster program

S3Blaster program measures performance of S3. For a given test scenario,
S3Blaster emits requests to S3. By collecting responses received from S3,
S3Blaster computes different metrics to measure performance of S3.

## Performance metrics

S3Blaster computes two performance metrics:

* Latency of a request

Latency of a request is the interval between the time the request is sent to
S3 and the time S3Blaster receives the request's response. S3Blaster
computes different statistics on request latencies: average, standard-deviation,
percentiles.

* Number of operations per second

This is the number of responses that S3Blaster receives per second.
S3Blaster computes average number of operations/s.

## Working schema

```
+-------------+                +--------+
|S3Blaster    |                |Plotter |
|Master       +-----plot------->        |
|             | +---plot------->        <--------plot--------+
+----^------+-+ |              +--^-----+                    |
     |      |   |                 |                          |
     |      |   |                 |                          |
     |      +--------forks---+---------------------------+   |
     |      |   |            |    |                      |   |
     |     +v---+----+     +-v----+--+                 +-v---+---+
     |     |S3Blaster|     |S3Blaster|     ...         |S3Blaster|
     |     |Worker 1 |     |Worker 2 |                 |Worker n |
     |     +---^-----+     +-----^---+                 +--------^+
     |         |                 |                              |
     |       requests/         requests/                      requests/
     |       responses         responses                      responses
     |         |                 |                              |
     |         |    +----------------+--------------------------+
 monitoring    |    |            |   |                          |
     |         | +---------------+---------------------------+  |
     |         | |  |            |   |                       |  |
     |         +---------------+---------------------------+ |  |
     |         | |  |          | |   |                     | |  |
     |     +---v-v--v--+    +--v-v---v--+              +---v-v--v--+
     |     |S3 Server 1|    |S3 Server 2|              |S3 Server N|
     |     |           |    |           |     ....     |           |
     |     |           |    |           |              |           |
     |     +----^------+    +-----^-----+              +------^----+
     |          |                 |                           |
     |          |                 |                           |
     +----------+-----------------+---------------------------+

             Figure 1: Working schema of S3Blaster program
```

A working schema of S3Blaster is shown in Figure 1. Note, if there is no fork
(clusters), S3Blaster workers in the schema are replaced by the S3Blaster
Master. Roles of each component are described below.

### S3Blaster Master

Besides forking workers (if relevant), S3Blaster Master does following jobs:

* Monitoring resources' consuming (CPU & Memory usage) of running processes on
    all servers.

* Gathering statistics results computed from all workers.

* Forwarding obtained results to `Plotter` that plots appropriated graphs

### S3Blaster Worker

* Based on programmed scenario, each worker sends requests to S3 Servers and
    then computes performance metrics based on responses received from the
    servers.

* Forwarding obtained results to `Plotter` that plots appropriated graphs.

### Plotter

The component displays performance metrics and monitored resources' consuming
on graphs.

## Program structure

The program consists of three main files:

* `s3blaster.js`
    is the **core** of S3Blaster. S3Blaster master does the following jobs:
    * Forking S3Blaster workers (if relevant)
    * Gathering statistics results computed from all workers
    * Storing statistics in files that are used for plotting graphs. There are
    2 files `.txt` containing statistics whose suffix names are
    *_ssm* (for system monitoring) and *_summary* (for summary results).

    Whereas, S3Blaster worker does the following jobs:
    * Sending/receiving requests to/from S3
    * Calculating statistics on request latency, number of operations/s
    * Storing statistics in files that are used for plotting graphs. There are
    5 files `.txt` containing statistics whose suffix names are
    *_live*, *_stats*, *_thread*, *_pdf_func*, *_cdf_func*.

* `config.js`
    contains all input parameters for S3Blaster. By assigning
appropriated parameters in this file, we determine a desired use-case that we
want to measure the performance.

* `plotter.js`
    plots graphs showing statistics measured by S3Blaster. Plotter generates
    two graphs for *_ssm* and *_summary* files sent from S3Blaster Master.
    For each S3Blaster worker, Plotter could generate up to 5 graph files
    whose suffix names are *_stats*, *_thread*, *_size*, *_pdf*, *_cdf*.

Besides, monitoring of resources' consuming of processes on servers are
implemented in files in `ssm` folder.

### Pre-programmed test

There are six pre-programmed tests:

* Simple test: measures performance for
    - Connector: single
    - Bucket: single and multiple
    - Requests: put, get, delete in sequential and mixed schedule
    - Object size: 8KB
    - #parallel requests: 64
    - Run time: 10 second per test

    How to run: `npm run s3simple`

* Standard test: measures performance for
    - Connector: single, haproxy and balancing
    - Bucket: single and multiple
    - Requests: put, list, get, get ACL, delete, combine in sequential and mixed
 schedule
    - Object size: 8KB, 40KB
    - #parallel requests: 50
    - Run time: 100 second per test
    - #forks: 1 and 5 (for balancing)

    How to run: `npm run s3standard`

* Full test: measures performance for
    - Connector: single, haproxy and balancing
    - Bucket: single and multiple
    - Requests: put, list, get, get ACL, delete, combine in sequential and mixed
 schedule
    - Object size: 0B, 8KB, 40KB, 100KB, 512KB, 1MB, 10MB
    - #parallel requests: 1, 10, 50, 100, 200
    - Run time: 100 second per test
    - #forks: 1 and 5 (for balancing)

    How to run: `npm run s3full`

* Object sizes test: measurement for different object sizes
    - Connector: single
    - Bucket: single and multiple
    - Requests: put, get, delete in sequential and mixed schedule
    - Object size: 0, 1, 10, 20, 30, 40, 50, 55, 60, 110, 120, 150, 200 (KB)
    - #parallel requests: 1, 50
    - Run time: 10 second per test

    How to run: `npm run s3sizes`

* Parallel requests test: measurement for different #parallel requests
    - Connector: single
    - Bucket: single and multiple
    - Requests: put, get, delete in sequential and mixed schedule
    - Object size: 0, 10 (KB)
    - #paral reqs: 1, 30, 50, 64, 90, 128, 150, 200, 256, 300, 350, 400, 500
    - Run time: 20 second per test

    How to run: `npm run s3parallel`

* Multipart upload test: measurement for multipart upload
    - Connector: single
    - Bucket: single and multiple
    - Requests: multi-upload, get, delete in sequential and mixed schedule
    - Object size: 100MB, 1GB
    - Part size: 5MB
    - #paral reqs: 50
    - Run time: 200 second per test

    How to run: `npm run s3mpu`

By default, output results are stored in a sub-folder of the `results`
directory. A default name for the sub-folder is the current date. However, the
output folder can be specified by using the environment variable FOLDERNAME, e.g.

`FOLDERNAME=release/today npm run s3standard`

Then, all output files will be stored in `release/today` directory.

## How to run S3Blaster

S3Blaster is executed via:

`mocha lib/s3blaster.js`

Default input parameters are given in the `lib/config.js` file. The parameters
in the file will be overwritten by using command line. A full description
of input parameters are shown in the next section.

## Input parameters

Input parameters are given either by the `lib/config.js` or by command line.
Note, parameters assignation via command line has a higher priority than that
from the `lib/config.js` file.

### From `lib/config.js`

Parameters are stored in the `config` object with different properties each for
its own purpose:

#### For account's information

```javascript
acc: {
    user,
    publicKey,
    privateKey,
    passphrase,
    password,
    accessKeyId,
    secretAccessKey,
}
```

These secret information should be stored in a file whose path is given via
`--acc-file` in command line. A default name for that file is
`.scality_credentials`.  In the file, the information are stored in the following
formula:

```
accessKeyId:your_access_key_id
secretAccessKey:your_secret_access_key
user:your_user
password:your_password
publicKey:path_to_your_public_key_file
privateKey:path_to_your_private_key_file
passphrase:passphrase_for_your_private_key
```

Note, the last five parameters might be required for monitoring resources's
consuming by running processes.

#### For connections to S3

List of servers where S3 Servers are running should be stored in a JSON file
whose path is given via  `--servers-list` in command line. By default,
they are given in `servers` in `config.json` file. The list of servers should be
given as follows:

```
{
    "servers":[
        "address_of_server_1",
        "address_of_server_2",
        "address_of_server_3"
    ]
}
```

Other parameters for connecting to S3 are given by:

```javascript
conn: {
    // host is either:
    // - server's address
    // - 'single', first server from the server list
    // - 'balancing', i.e. each S3 worker connects to a single server
    host: 'localhost',
    // port of S3 Server or haproxy
    port: 8000,
    forksNb: 1,
    // list of servers where S3 Servers are running
    servers,
}
```


#### For databases

```javascript
db: {
    bucketsNb: 1,
    bucketPrefix: 'bucketprefix',
    objectsNb: 100,
    // number of objects created initially in each bucket
    fillObjs: 100,
    // object sizes: either '<items>' or 'min:step:max'
    sizes: '8',
    // unit: 'B', 'KB', 'MB', 'GB'
    unit: 'KB',
    // part size for multipartUpload, in MB
    partSize: 10,
}
```

#### For simulation scenario to measure performance

```javascript
simul: {
    // requests for testing. Available requests are put, get, get-acl, delete,
    //   list, combine(put->get->delete)
    requests: 'put,get,delete',
    // proportion of requests
    proprReqs: [1, 1, 1],
    // indices range of objects for requests either 'all' or 'min:max'
    range: ['all', 'all', 'all'],
    // two simulation schedules
    //  - 'each': requests are tested sequentially by their types
    //  - 'mixed': random request type is chosen for testing
    schedule: 'mixed',
    // the way for choosing key of object for next request of a same type
    // either 'rand' for random or 'seq' for sequential way
    nextKey: 'seq',
    // number of parallel requests, either '<items>' or 'min:step:max'
    paralReqs: '64',
    // array of rates for sending requests from each fork of s3blaster
    // Each rate corresponds to a type of request
    // either ['max', 'max'] or array of numbers
    sendReqRates: [500, 500, 500],
    // max number of observations for a each request type with a combination
    // of parameters (paralReqs, object size)
    observationsNb: 1000000,
    // accepting flag for getting NoSuchKey objects
    noKeyFlag: false,
    // frequency to show stats on console
    freqShow: 1000,
    // sampling step for estimating pdf and cdf (in ms)
    samplingStep: 1,
    // percentiles, in %
    percentiles: [60, 80, 90, 95, 99, 100],
    // max run time (in second) for each request type with a combination
    // of parameters (paralReqs, object size)
    runTime: 100,
    // flag for monitoring resources' consuming of running processes
    ssm: false,
    // rate for getting live stats and servers' stats, in ms
    rate: 1000,
    // flag for showing both live and global stats
    liveGlobal: false,
    // choose servers' stats for monitoring: either 'all' or a list of
    //  - 'repdMap':  memory & cpu usage of RepdMapServer process
    //  - 'ioStat':   %util of all ssd disks
    //  - 'bucketd':   memory & max %cpu usage of every bucketd processes
    //  - 'repd':   memory & %cpu usage of repd processes
    //  - 'supervisord':  memory &  %cpu usage of supervisord processes
    //  - 'vaultd':  memory &  %cpu usage of vaultd processes
    //  - 's3':   memory & max %cpu usage of every S3 process
    //  - 'ironman':  memory & sum %cpu usage of all IronMan processes
    ssmTypes: 'all',
    // dynamic extra processes for monitoring, e.g. 'pattern1,pattern2'
    // Note: the given pattern will be used to monitor the desired process
    // Return total memory & %cpu usage of all processes found by each pattern
    monitors: 'sproxyd',
}
```

#### For output graphs

```javascript
plotter: {
    // available graphs to plot:
    //  - 'avg-std' for average, standard-deviabtion, percentiles
    //  - 'pdf-cdf' for estimated probability and cumulative distr. func.
    //  - 'size' for request latency vs. object sizes
    //  - 'paral-req' for request latency vs. number of parallel requests
    //  - 'live' for live stats and ssm results
    // Two ways to assign 'all' or '<items>'
    graphs: 'all',
    // suffix for output graph files
    output: '_s3blaster_output',
    // flag for fitting curves
    fitPlot: false,
    // specified message that displays on all graphs
    message: 'S3 version: ,\n' +
             'First test',
}
```

### From command line

A full description of command line is shown by using `-h` command.

```javascript
// Host:
  -H, --host //  host address
  -P, --port //  port
// Clustering:
  -w, --n-forks //  number of forks
// Request type:
  --requests <items> //  ordered list of requests.
// Proportion of requests:
  -p, --propr-reqs //  proportion of requests
// Simulation policy:
  -m, --simul //  type of simulation, either 'each' for simulEach, 'mixed' for simulMixed
// Number of observations:
  -n, --n-obsers //  number of observations
// Bucket:
  -B, --bucket-prefix //  prefix for bucket name
  --n-buckets //  number of buckets
  --n-objs //  number of objects per bucket
// Data sizes:
  -s, --sizes <items> or min:step:max
  -u, --unit //  data size unit, either 'B', 'KB', 'MB' or 'GB'
// Number of paralle requests:
  -N, --paral-reqs <items>  or min:step:max
// Delay between two consecutive simulations (in second)
  --simul-delay
// Graphs to plot:
  -g, --graphs <items> //  `a` for avg-std, `p` for pdf-cdf,
                       // 's' for data sizes, 't' for threads, 'l' for live
// Suffix for output files:
  -f, --output //  suffix for output files
// Max simulation running time:
  -t, --run-time //  max running time per test (second)
// Prefix for object keys
  --prefix-key
// Next key choosing:
  --next-key //  next key choosing either `rand` (random), `seq` (sequential)
// Initialization bucket:
  --fill-objs //  number of objects created in buckets
// Accept getting non-existing objects or not:
  --ok-nokey //  accept for getting NoSuchKey objects
// Flag for get any key
  --get-anyKey
// For multipartUpload
  --part-sizes      // part sizes (in MB)
  --mpu-paralreqs   // Number of parallel requests for uploading parts
// Frequency to show:
  --freq-show //  frequency to show stats
// Indices range for requests: min:max,min:max,...
  --range
// Estimating probability and cumulative distr. funcs:
  --samling-step //  sampling step
// List of percentiles on requests latency
  --percentiles
// Setting for Plotter:
  --fit-plot //  enable fit feature for plotter
// Setting for live and global stats:
  --live-global //  enable show both live and global stats
// Sending requests rate:
  --req-rates //  array of rates for sending requests
// Monitoring servers:
  --ssm //  enable monitoring resources' consuming on servers via ssh
// Rate for getting monitored stats, in ms
  --rate
// Flag for displaying ssm on console: true or false
  --display-ssm
// Flag for cleaning database at the end of simulation: true or false
  --dontCleanDB
// Output files storing statistics and graphs:
  -f, --output //  suffix for output files
  --message //  specified message shown on all graphs
// Type of output graph files, either pdf or png
  --output-type
```

## Output: statistics and graphs

For each test, s3blaster generates files containing statistics results (`.txt`)
and graph files (`.pdf` or `.png`). Main configuration  information is shown on top of each statistics/graph file.

* Summary results

Summary results are shown in *_summary* text/graph files. It contains
performance metrics that are computed based on results from all workers (if
relevant). Moreover, if the monitoring of servers was active, the file show
amount of storage using by metadata. The amount is computed as the difference
of meta-stores between before and after test.

* Detailed result files

For each S3Blaster worker, there are five `.txt` files and five graph files.

    * *_live* file contains real-time performance metrics. The 'real-time' means
    that the metrics are calculated from requests/responses received within the last duration time. The time duration is determined by `rate` in the
    `lib/config.js` file. Results of the file will be used to generate *_live*
    graph.

    * *_stats* file contains performance metrics computed after some given
    number of requests successes. A graph file is generated for each such file.

    * *_thread* file contains statistics vs. number of parallel requests and
        number of object sizes. A graph file is generated for each such file.

    * *_pdf_func* file contains estimated probability distribution function. A
    graph file is generated for each such file.

    * *_cdf_func* file contains estimated cumulative distribution function. A
    graph file is generated for each such file.

In each graph file, there could be some figures that are located in rows and
columns layout. Graphs on a row/column have a same configuration parameter,
e.g. same type of request, same object size etc.

* Monitored resources' consuming

If the monitoring of resources' consuming by running processes was active,
collected  are stored in *_ssm.txt* file. These results combined with *_live*
statistics from each worker will be shown in a single graph *_live* file. In
that file, measured performance and resources' consuming are shown versus
elapsed time.

## Examples

* Example 1

Single connector, single bucket with 1000 objects, mixed requests, object 8KB,
run in 100 seconds

```javascript
mocha lib/s3blaster.js -H localhost -P 8000
--n-buckets 1 --fill-objs 1000 --n-objs 1000 --size 8 --unit KB --requests
put,get,delete --simul mixed --run-time 100 --output example1
```

* Example 2

Single connector, multiple buckets, sequential requests, object 8KB & 100KB

```javascript
mocha lib/s3blaster.js -H localhost -P 80
--n-buckets 100 --fill-objs 0 --n-objs 1000 --size 8,100 --unit KB --requests
put,get,delete --simul each --run-time 100 --output example2
```

* Example 3

*Balancing* connectors, 10 forks, monitoring servers, multiple buckets,
mixed requests with their proportion and range

```javascript
mocha lib/s3blaster.js -H balancing -P 8000 --n-forks 10
--n-buckets 100 --fill-objs 0 --n-objs 1000 --size 8 --unit KB --requests
put,get --propr-reqs 2,8 --r-put 0,500 --r-get 500,1000 --simul each --ssm
--run-time 100 --output example3
```
