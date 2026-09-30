package main

import (
	"encoding/base64"
  "encoding/json"
  "fmt"
  "math"
  "os"
  "strconv"
  "strings"
  "time"
)

const n = 25000
const gridSize = 192
const nestedLoopOperations = gridSize * gridSize
var sink int64
type result struct { Samples int `json:"samples"`; Warmup int `json:"warmup"`; TargetSampleMs float64 `json:"targetSampleMs"`; RunsPerSample int64 `json:"runsPerSample"`; OperationsPerSample int64 `json:"operationsPerSample"`; MinMs float64 `json:"minMs"`; MedianMs float64 `json:"medianMs"`; P95Ms float64 `json:"p95Ms"`; MaxMs float64 `json:"maxMs"`; CoefficientOfVariation float64 `json:"coefficientOfVariation"`; Checksum string `json:"checksum"` }
type wireInteger struct { Version int `json:"version"`; Kind string `json:"kind"`; Value string `json:"value"` }
func measure(work func() int64, samples int, targetMs float64, ops int64) result {
  for i:=0;i<2;i++ { sink=work() }
  const maximumRuns int64 = 1_048_576
  runs:=int64(1)
  elapsedMs:=0.0
  for { start:=time.Now(); for i:=int64(0);i<runs;i++ { sink=work() }; elapsedMs=float64(time.Since(start).Nanoseconds())/1e6; if elapsedMs>=targetMs||runs==maximumRuns { break }; runs*=2; if runs>maximumRuns { runs=maximumRuns } }
  if elapsedMs<targetMs { panic("Go benchmark could not reach the sample target") }
  check:=work(); values:=make([]float64,0,samples)
  for s:=0;s<samples;s++ { start:=time.Now(); for i:=int64(0);i<runs;i++ { value:=work(); if value!=check { panic("unstable benchmark result") }; sink=value }; values=append(values,float64(time.Since(start).Nanoseconds())/1e6) }
  sorted:=append([]float64{},values...); for i:=range sorted { for j:=i+1;j<len(sorted);j++ { if sorted[j]<sorted[i] { sorted[i],sorted[j]=sorted[j],sorted[i] } } }
  mean:=0.0;for _,v:=range values{mean+=v};mean/=float64(len(values));variance:=0.0;for _,v:=range values{d:=v-mean;variance+=d*d};variance/=float64(len(values));cv:=0.0;if mean!=0{cv=variance/mean/mean}
  return result{Samples:samples,Warmup:2,TargetSampleMs:targetMs,RunsPerSample:runs,OperationsPerSample:runs*ops,MinMs:sorted[0],MedianMs:sorted[len(sorted)/2],P95Ms:sorted[(len(sorted)*95+99)/100-1],MaxMs:sorted[len(sorted)-1],CoefficientOfVariation:cv,Checksum:strconv.FormatInt(check,10)}
}
func integerLoop()int64{var total int64;for i:=0;i<n;i++{total=(total*33+1)%1000003};return total}
func mix(a,b int64)int64{return (a*33+b)%1000003}
func functionCalls()int64{var total int64;for i:=0;i<n;i++{total=mix(total,1)};return total}
func numberLoop()int64{var total float64;for i:=0;i<n;i++{total=math.Mod(total*3.0+1.0,1000003.0)};return int64(total)}
func stringSearch(haystack,needle string)int64{var total int64;for i:=0;i<n;i++{if strings.Contains(haystack,needle){total++}};return total}
func textScan(text string)int64{var errors int64;for _,line:=range strings.Split(text,"\n"){if strings.Contains(line," ERROR "){errors++}};return errors}
func listIteration()int64{var total int64;for i:=0;i<n;i++{values:=[]int64{1,2,3,4};for _,value:=range values{total=(total*33+value)%1000003}};return total}
func nestedLoops()int64{var total int64;for row:=int64(0);row<gridSize;row++{for column:=int64(0);column<gridSize;column++{total=(total*33+1)%1000003}};return total}
func isPrime(value int64)bool{if value<2{return false};for divisor:=int64(2);divisor*divisor<=value;divisor++{if value%divisor==0{return false}};return true}
func primeCount()int64{var count int64;for value:=int64(2);value<=1000;value++{if isPrime(value){count++}};return count}
func fib(value int64)int64{if value<2{return value};return fib(value-1)+fib(value-2)}
func recursiveCalls()int64{return fib(20)}
type event struct { tag int; integerPayload int64; booleanPayload bool }
func enumConstructionMatching()int64{var total,value int64;for i:=0;i<n;i++{value=(value*33+1)%1000003;item:=event{tag:2,integerPayload:value};if item.tag==2&&item.integerPayload%2==0{total++}};return total}
func nextValue(value int64)int64{return(value*33+1)%1000003}
func unwrapOptional(item struct{present bool;value int64})int64{if item.present{return item.value};return 0}
func unwrapResult(item struct{ok bool;value,error int64})int64{if item.ok{return item.value};return item.error}
func optionalStep(value int64)int64{candidate:=nextValue(value);return(candidate+unwrapOptional(struct{present bool;value int64}{true,candidate}))%1000003}
func resultStep(value int64)int64{candidate:=nextValue(value);return(candidate+unwrapResult(struct{ok bool;value,error int64}{true,candidate,0}))%1000003}
func optionalMatch()int64{var total int64;for i:=0;i<n;i++{total=optionalStep(total)};return total}
func resultMatch()int64{var total int64;for i:=0;i<n;i++{total=resultStep(total)};return total}
func branchStep(value int64)int64{changed:=value;if changed%2==0{changed=changed/2+3}else{changed=(changed*33+1)%1000003};return changed}
func branchMutation()int64{var total int64;for i:=0;i<n;i++{total=branchStep(total)};return total}
type point struct{x,y int64}
func readPoint(value point)int64{return value.x+value.y}
func recordStep(value int64)int64{return readPoint(point{(value*33+1)%1000003,1})}
func recordAccess()int64{var total int64;for i:=0;i<n;i++{total=recordStep(total)};return total}
func filterTextList()int64{lines:=[]string{"ERROR disk","INFO ready","ERROR timeout","WARN low"};retained:=make([][]string,0,n);var total int64;for i:=0;i<n;i++{filtered:=make([]string,0,len(lines));for _,line:=range lines{if strings.Contains(line,"ERROR"){filtered=append(filtered,line)}};total+=int64(len(filtered));retained=append(retained,filtered)};return total}
func foldTextList()int64{lines:=[]string{"ERROR disk","INFO ready","ERROR timeout","WARN low"};var total int64;for i:=0;i<n;i++{for _,line:=range lines{if strings.Contains(line,"ERROR"){total++}}};return total}
func textConcat()int64{parts:=strings.Split("BMEC native"," ");var total int64;for i:=0;i<n;i++{joined:="";for _,part:=range parts{if joined==""{joined=part}else{joined=joined+" "+part}};if joined=="BMEC native"{total++}};return total}
func mapTextList()int64{lines:=strings.Split("ERROR disk\nINFO ready\nERROR timeout\nWARN low","\n");retained:=make([][]string,0,n);var total int64;for i:=0;i<n;i++{mapped:=make([]string,0,len(lines));for _,line:=range lines{mapped=append(mapped,line+"!")};total+=int64(len(mapped));retained=append(retained,mapped)};return total}
func collatzSteps(value int64)int64{var steps int64;for value>1{if value%2==0{value/=2}else{value=value*3+1};steps++};return steps}
func jsonEncode()int64{var total int64;for i:=0;i<n;i++{encoded,_:=json.Marshal(wireInteger{1,"integer",strconv.FormatInt(total,10)});total=(total+int64(len(encoded)))%1000003};return total}
func base64Encode(input,expected string)int64{var total int64;for i:=0;i<n;i++{if base64.StdEncoding.EncodeToString([]byte(input))==expected{total++}};return total}
func base64Decode(encoded,expected string)int64{var total int64;for i:=0;i<n;i++{decoded,err:=base64.StdEncoding.DecodeString(encoded);if err==nil&&string(decoded)==expected{total++}};return total}
func filesystemRead(path string)int64{data,err:=os.ReadFile(path);if err!=nil{return -1};return int64(len(data))}
func main(){if len(os.Args)<10{panic("usage: benchmark haystack needle fixture samples target-ms base64 encoded-text collatz-input text-scan-file")};haystack,needle,path,encoded,payload,scanPath:=os.Args[1],os.Args[2],os.Args[3],os.Args[6],os.Args[7],os.Args[9];collatzInput,_:=strconv.ParseInt(os.Args[8],10,64);scanBytes,err:=os.ReadFile(scanPath);if err!=nil{panic("could not read text scan fixture")};scanText:=string(scanBytes);samples:=10;target:=50.0;if len(os.Args)>4{samples,_=strconv.Atoi(os.Args[4])};if len(os.Args)>5{target,_=strconv.ParseFloat(os.Args[5],64)};out:=map[string]any{"version":10,"workloads":map[string]result{"integerLoop":measure(integerLoop,samples,target,n),"functionCalls":measure(functionCalls,samples,target,n),"numberLoop":measure(numberLoop,samples,target,n),"stringSearch":measure(func()int64{return stringSearch(haystack,needle)},samples,target,n),"textScan":measure(func()int64{return textScan(scanText)},samples,target,128),"listIteration":measure(listIteration,samples,target,n),"nestedLoops":measure(nestedLoops,samples,target,nestedLoopOperations),"primeCount":measure(primeCount,samples,target,999),"recursiveCalls":measure(recursiveCalls,samples,target,1),"enumConstructionMatching":measure(enumConstructionMatching,samples,target,n),"optionalMatch":measure(optionalMatch,samples,target,n),"resultMatch":measure(resultMatch,samples,target,n),"branchMutation":measure(branchMutation,samples,target,n),"recordAccess":measure(recordAccess,samples,target,n),"filterTextList":measure(filterTextList,samples,target,n*4),"foldTextList":measure(foldTextList,samples,target,n*4),"textConcat":measure(textConcat,samples,target,n*2),"mapTextList":measure(mapTextList,samples,target,n*4),"collatzSteps":measure(func()int64{return collatzSteps(collatzInput)},samples,target,1),"jsonEncode":measure(jsonEncode,samples,target,n),"base64Encode":measure(func()int64{return base64Encode(payload,encoded)},samples,target,n),"base64Decode":measure(func()int64{return base64Decode(encoded,payload)},samples,target,n),"filesystemRead":measure(func()int64{return filesystemRead(path)},samples,target,1)}};bytes,err:=json.Marshal(out);if err!=nil{panic(err)};fmt.Println(string(bytes))}
