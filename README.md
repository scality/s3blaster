# S3Blaster program

S3Blaster program measures performance of S3 servers. For a given test scenario,
S3Blaster emits requests to S3 servers. By collecting responses, S3Blaster
computes different metrics to measure performance of S3.

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

![Schema](./img/s3blaster.png)

Figure 1: Working schema of S3Blaster program

A working schema of S3Blaster is shown in Figure 1. Note, if there is no fork
operation (clusters), S3Blaster workers in the schema are replaced by the
S3Blaster Master. Roles of each component are described below.

### S3Blaster Master

Besides forking workers (if relevant), S3Blaster Master does following jobs:

* Monitoring resources' consuming (CPU & Memory usage) of running processes on
    all servers.

* Gathering statistics results computed from all workers.

* Forwarding obtained results to `Plotter` that plots appropriated graphs.

### S3Blaster Worker

* Based on programmed scenarios, each worker sends requests to S3 Servers and
    then computes performance metrics based on responses received from the
    servers.

* Forwarding obtained results to `Plotter` that plots appropriated graphs.

### Plotter

The component displays performance metrics and monitored resources' consuming
on graphs.

## Installation

Simple as `npm install`

### Plot dependencies

Output graphs would be created using `gnuplot` program. To install it on Ubuntu

```
sudo apt-get install libcairo2-dev
sudo apt-get install libpango1.0-dev
sudo apt-get install gnuplot
```

For other OS, see Cairo (https://cairographics.org/download/) and
gnuplot (http://www.gnuplot.info/download.html)

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
    get all input parameters for S3Blaster. All input parameters for s3blaster
    can be assigned via the following ways with a decreasing priority
    level, i.e. parameter will get value given by the highest priority one:

    - command line
    - a JSON file defined by `--config` command, `config.json` by default
    - initialized in `config.js` file

    For credential keys `accessKeyId` and `secretAccessKey`, they can be
    assigned by the following ways with a decreasing priority level:
    - command line:

    ```
    --accessKeyId = your_access_key_id
    --secretAccessKey = your_secret_access_key
    ```

    - config JSON file, in "acc" sub-object:

    ```
    "accessKeyId": "your_access_key_id"
    "secretAccessKey": "your_secret_access_key"
    ```

    - environment variable:

    ```
    ACCESSKEYID=your_access_key_id
    SECRETACCESSKEY=your_secret_access_key
    ```

    - credential file defined by `--accFile`, default file `~/.s3cfg`

    ```
    access_key = your_access_key_id
    secret_key = your_secret_access_key
    ```

* `plotter.js`
    plots graphs showing statistics measured by S3Blaster. Plotter generates
    two graphs for *_ssm* and *_summary* files sent from S3Blaster Master.
    For each S3Blaster worker, Plotter could generate up to 5 graph files
    whose suffix names are *_stats*, *_thread*, *_size*, *_pdf*, *_cdf*.

An additional file `runS3Blaster.js` allows executing S3Blaster with input
parameters stored in an object that is used for pre-programmed tests (see
    [Pre-programmed tests](#pre-programmed-tests))

Besides, monitoring of resources' consuming of processes on servers and
monintoring storage size of Metadata store are implemented in files in `ssm`
folder.

## How to run S3Blaster

S3Blaster is executed with default input parameters with: `npm start`

By default, output results are stored in a sub-folder of the `results`
directory. A default name for the sub-folder is the current date. A specified
output folder can be defined by using the environment variable FOLDERNAME, e.g.

`FOLDERNAME=release/today npm start`

Then, all output files will be stored in the `./results/release/today`
directory.

### Plot manipulation

There are two plot actions applicable for simulation results. Configuration
info and results of a simulation is stored in an `.id` file whose prefix is
same as stats files.

* Re-plot graphs

    All graphs of a simulation can be re-plotted with modifying on

    - Prefix for output graph files
    - Type of output files (pdf or png)
    - Font size
    - Font type.

    CLI for re-plot:

    ```
    node lib/plotter.js --replot path_to_id_file --outputPrefixName <name>
    --outputType <type> --fontType <type> --fontSize <size>
    ```

* Performance comparison

    Performance of different tests are shown in a same file. The graph file
    contains two pages for latency and #operations/s performance metrics.

    In each page, graphs are placed in a layout where each column corresponds
    to a request type, e.g. put, get

    Each graph displays performances for an object size. The x-axis is number of
    parallel requests. Each curve in the graph shows performance of each test.

    CLI for comparison:

    ```
    node lib/plotter.js --compare
    path_to_id_file_test_1,path_to_id_file_test_2,path_to_id_file_test_3
    ```

### Main input parameters

There are multiple configurable input parameters as shown in
`config.json` file. However, some of them should be correctly
assigned for an appropriated measurement:

Name | Related keys
--- | ---
Credential keys | `accessKeyId`, `secretAccessKey`
S3 servers' address | `host`, `port`
Requests for measuring | `requests`
Schedule of requests | `schedule`
Buckets | `bucketPrefix`, `bucketsNb`
Objects | `objectsNb`, `sizes`, `unit`
Measurement time | `runTime`, `observationsNb`
Monitoring | `ssm`, `servers`, `user`, `publicKey`, `privateKey`, `mdPath`
Multipart Upload | `partSizes`

To run S3Blaster with other specified parameters, please see [configuration]
(./CONFIGURATION.md).

## Output: statistics and graphs

For each test, s3blaster generates files containing statistics results (`.txt`)
and graph files (`.pdf` or `.png`). Main configuration  information is shown on
top of each statistics/graph file.

* Summary results

    Summary results are shown in *_summary* text/graph files. It contains
performance metrics that are computed based on results from all workers (if
relevant). Moreover, if the monitoring of servers was active, the file show
amount of storage using by metadata. The amount is computed as the difference
of meta-stores between before and after test.

* Detailed result files

    For each S3Blaster worker, there are five `.txt` files and five graph files.

    * *_live* file contains real-time performance metrics. The 'real-time' means
    that the metrics are calculated from requests/responses received within the
    last duration time. The time duration is determined by `rate` in the
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
node index.js --host localhost --port 8000
--bucketsNb 1 --objectsNb 1000 --sizes 8 --unit KB --requests
put,get,delete --schedule mixed --runTime 100 --output example1
```

* Example 2

Haproxy connector with port 80, multiple buckets, sequential requests, object
8KB & 100KB

```javascript
node index.js --host localhost --port 80
--bucketsNb 100 --objectsNb 1000 --sizes 8,100 --unit KB --requests
put,get,delete --schedule each --runTime 100 --output example2
```

* Example 3

*Balancing* connectors, 10 forks, monitoring servers, multiple buckets,
mixed requests with their proportion and range

```javascript
node index.js --host balancing --port 8000 --forksNb 10
--bucketsNb 100 --objectsNb 1000 --sizes 8 --unit KB --requests
put,get --proprReqs 2,8 --range 0:500,500:1000 --schedule each --ssm true
--runTime 100 --output example3
```

## Pre-programmed tests

There are six pre-programmed tests as below.

 Parameters | S3Simple | S3Standard | S3Full | S3Sizes | S3Parallel | S3MPU
 --- | --- | --- | --- | --- | --- | ---
 S3 Connector | single | single, balancing | single, haproxy, balancing | single | single | single
 #S3blaster workers  | 1 | 1 & multiple | 1 & multiple | 1 | 1 & multiple | 1
 Bucket | single & multiple |  single & multiple | single & multiple | single & multiple | single & multiple | single & multiple
 Requests | `put`, `get`, `delete` | `put`, `get`, `delete` | `put`, `list`, `get`, `get ACL`, `delete`, `combine` | `put`, `get`, `delete` | `put`, `get`, `delete` | `multi-upload`, `get`, `delete`
 Schedule | `sequential` & `mixed` | `sequential`| `sequential` & `mixed` | `sequential` & `mixed` | `sequential` | `sequential` & `mixed`
 Object size | `OB`, `10KB` | `OB`, `10KB`, `1MB` | `OB`, `10KB`, `512KB`, `1MB`, `10MB` | `0, 10, .., 90KB` & `100, 200, .., 900KB` & `1, 2, .., 10MB` | `OB`, `10KB`, `1MB` | `1GB` (part size `5MB`, `20MB`)
 #parallel requests | 64 | 1, 32, 64, 128, .., 2048 | 1, 8, 16, 32, .., 2048 | 1, 50 | 32, 64, 128, .., 10240 | 1, 2, 4, 8, 16
 Run time (s) | 60 | 120 | 240 | 600 | 600 | 1200
 |
 **Execution cmd** | `npm run s3simple` | `npm run s3standard` | `npm run s3full` | `npm run s3sizes` | `npm run s3parallel` | `npm run s3mpu`
