#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <iterator>
#include <limits>
#include <numeric>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

using Clock = std::chrono::steady_clock;
constexpr long long n = 25000;
constexpr long long gridSize = 192;
constexpr long long nestedLoopOperations = gridSize * gridSize;
constexpr long long benchmarkStepLimit = 5'000'000;
volatile long long sink = 0;
long long checkedIntegerAdd(long long a,long long b) { if((b>0&&a>std::numeric_limits<long long>::max()-b)||(b<0&&a<std::numeric_limits<long long>::min()-b))throw std::runtime_error("PIPE-RUNTIME-004: Integer overflow");return a+b; }

long long integerLoop() { long long total=0; for(long long i=0;i<n;i++) total=(total*33+1)%1000003; return total; }
long long mix(long long a,long long b) { return (a*33+b)%1000003; }
long long functionCalls() { long long total=0; for(long long i=0;i<n;i++) total=mix(total,1); return total; }
double numberLoop() { double total=0; for(long long i=0;i<n;i++) total=std::fmod(total*3.0+1.0,1000003.0); return total; }
long long stringSearch(const std::string& haystack,const std::string& needle) { long long total=0; for(long long i=0;i<n;i++) if(haystack.find(needle)!=std::string::npos) total++; return total; }
long long textScan(const std::string& text) { std::vector<std::string_view> lines; lines.reserve(128); size_t start=0; for(;;) { const size_t end=text.find('\n',start); if(end==std::string::npos) { lines.emplace_back(text.data()+start,text.size()-start); break; } lines.emplace_back(text.data()+start,end-start); start=end+1; } long long errors=0; for(auto line:lines) if(line.find(" ERROR ")!=std::string_view::npos) errors++; return errors; }
long long listIteration() { long long total=0; for(long long i=0;i<n;i++) { std::array<long long,4> values{1,2,3,4}; for(long long value:values) total=(total*33+value)%1000003; } return total; }
long long nestedLoops() { long long total=0; for(long long row=0;row<gridSize;row++) for(long long column=0;column<gridSize;column++) total=(total*33+1)%1000003; return total; }
bool isPrime(long long value) { if(value<2)return false; for(long long divisor=2;divisor*divisor<=value;divisor++)if(value%divisor==0)return false; return true; }
long long primeCount() { long long count=0; for(long long value=2;value<=1000;value++)if(isPrime(value))count++; return count; }
long long fib(long long value) { if(value<2)return value; return fib(value-1)+fib(value-2); }
long long recursiveCalls() { return fib(20); }
struct Event { int tag; long long integerPayload; bool booleanPayload; };
bool isTarget(const Event& event) { return event.tag==2&&event.integerPayload%2==0; }
long long enumConstructionMatching() { long long total=0,value=0; for(long long i=0;i<n;i++) { value=(value*33+1)%1000003; const Event event{2,value,false}; if(isTarget(event)) total++; } return total; }
struct BenchOptional { bool present; long long value; };
struct BenchResultValue { bool ok; long long value; long long error; };
long long nextValue(long long value) { return (value*33+1)%1000003; }
long long unwrapOptional(BenchOptional item) { return item.present?item.value:0; }
long long unwrapResult(BenchResultValue item) { return item.ok?item.value:item.error; }
long long optionalStep(long long value) { const long long candidate=nextValue(value); return (candidate+unwrapOptional({true,candidate}))%1000003; }
long long resultStep(long long value) { const long long candidate=nextValue(value); return (candidate+unwrapResult({true,candidate,0}))%1000003; }
long long optionalMatch() { long long total=0; for(long long i=0;i<n;i++) total=optionalStep(total); return total; }
long long resultMatch() { long long total=0; for(long long i=0;i<n;i++) total=resultStep(total); return total; }
long long branchStep(long long value) { long long changed=value; if(changed%2==0) changed=changed/2+3; else changed=(changed*33+1)%1000003; return changed; }
long long branchMutation() { long long total=0; for(long long i=0;i<n;i++) total=branchStep(total); return total; }
struct Point { long long x; long long y; };
long long readPoint(const Point& point) { return point.x+point.y; }
long long recordStep(long long value) { return readPoint({(value*33+1)%1000003,1}); }
long long recordAccess() { long long total=0; for(long long i=0;i<n;i++) total=recordStep(total); return total; }
long long filterTextList() { const std::array<std::string_view,4> lines{"ERROR disk","INFO ready","ERROR timeout","WARN low"}; std::vector<std::vector<std::string_view>> retained; retained.reserve(n); long long total=0; for(long long i=0;i<n;i++) { std::vector<std::string_view> filtered; std::copy_if(lines.begin(),lines.end(),std::back_inserter(filtered),[](auto line){return line.find("ERROR")!=std::string_view::npos;}); total+=static_cast<long long>(filtered.size()); retained.push_back(std::move(filtered)); } return total; }
long long foldTextList() {
  long long steps=0,depth=1;
  auto charge=[&](long long count=1){if(steps>benchmarkStepLimit-count)throw std::runtime_error("PIPE-RUNTIME-006: Maximum execution steps exceeded");steps+=count;};
  charge(4); // main entry, split-list binding, accumulator binding, and repeat
  const std::array<std::string_view,4> lines{"ERROR disk","INFO ready","ERROR timeout","WARN low"};
  long long total=0;
  for(long long i=0;i<n;i++) {
    charge(); // total assignment in the repeat body
    long long count=0;
    for(auto line:lines) {
      if(depth>=128)throw std::runtime_error("PIPE-RUNTIME-006: Maximum call depth exceeded");
      ++depth;
      charge(3); // lambda entry, if statement, and selected return statement
      if(line.find("ERROR")!=std::string_view::npos)count=checkedIntegerAdd(count,1);
      --depth;
    }
    total=checkedIntegerAdd(total,count);
  }
  charge(); // main return
  return total;
}
long long textConcat() { const std::string source="BMEC native"; const size_t separator=source.find(' '); std::vector<std::string_view> parts; parts.emplace_back(source.data(),separator); parts.emplace_back(source.data()+separator+1,source.size()-separator-1); long long total=0; for(long long i=0;i<n;i++) { std::string joined; for(auto part:parts) { if(joined.empty()) joined=part; else joined=joined+" "+std::string(part); } if(joined=="BMEC native") total++; } return total; }
long long mapTextList() { const std::string input="ERROR disk\nINFO ready\nERROR timeout\nWARN low"; std::vector<std::string_view> lines; size_t start=0; for(;;) { const size_t end=input.find('\n',start); if(end==std::string::npos) { lines.emplace_back(input.data()+start,input.size()-start); break; } lines.emplace_back(input.data()+start,end-start); start=end+1; } std::vector<std::vector<std::string>> retained; retained.reserve(n); long long total=0; for(long long i=0;i<n;i++) { std::vector<std::string> mapped; mapped.reserve(lines.size()); for(auto line:lines) mapped.emplace_back(std::string(line)+"!"); total+=static_cast<long long>(mapped.size()); retained.push_back(std::move(mapped)); } return total; }
long long guardedSteps=0,guardedDepth=0;
void guardedStep() { if(++guardedSteps>100000) throw std::runtime_error("step limit"); }
long long fibWithBmecLimits(long long value) { if(guardedDepth>=128)throw std::runtime_error("depth limit");if(++guardedSteps>100000)throw std::runtime_error("step limit");++guardedDepth;guardedStep();if(value<2){guardedStep();--guardedDepth;return value;}guardedStep();const auto result=fibWithBmecLimits(value-1)+fibWithBmecLimits(value-2);--guardedDepth;return result; }
long long recursiveCallsWithBmecLimits() { guardedSteps=0;guardedDepth=0;return fibWithBmecLimits(20); }
long long collatzStepsWithBmecLimits(long long value) {
  if(guardedDepth>=128)throw std::runtime_error("PIPE-RUNTIME-006: Maximum call depth exceeded");
  if(++guardedSteps>benchmarkStepLimit)throw std::runtime_error("PIPE-RUNTIME-006: Maximum execution steps exceeded");
  ++guardedDepth;
  long long localSteps=guardedSteps;
  auto step=[&](long long count=1){if(localSteps>benchmarkStepLimit-count)throw std::runtime_error("PIPE-RUNTIME-006: Maximum execution steps exceeded");localSteps+=count;};
  step();long long steps=0;
  step();
  while(value>1){
    step(2);
    if(value%2==0)value/=2;
    else {if(value>std::numeric_limits<long long>::max()/3||value<std::numeric_limits<long long>::min()/3)throw std::runtime_error("PIPE-RUNTIME-004: Integer overflow");const long long tripled=value*3;if(tripled==std::numeric_limits<long long>::max())throw std::runtime_error("PIPE-RUNTIME-004: Integer overflow");value=tripled+1;}
    step();
    if(steps==std::numeric_limits<long long>::max())throw std::runtime_error("PIPE-RUNTIME-004: Integer overflow");
    ++steps;
  }
  step();guardedSteps=localSteps;--guardedDepth;return steps;
}
long long jsonEncode() { long long total=0; for(long long i=0;i<n;i++) { const auto encoded=std::string("{\"version\":1,\"kind\":\"integer\",\"value\":\"")+std::to_string(total)+"\"}"; total=(total+static_cast<long long>(encoded.size()))%1000003; } return total; }
int base64Value(unsigned char c) { if(c>='A'&&c<='Z')return c-'A';if(c>='a'&&c<='z')return c-'a'+26;if(c>='0'&&c<='9')return c-'0'+52;if(c=='+')return 62;if(c=='/')return 63;return -1; }
std::string decodeBase64(const std::string& input) { if(input.size()%4)throw std::runtime_error("invalid base64");std::string output;output.reserve(input.size()/4*3);for(size_t i=0;i<input.size();i+=4){bool last=i+4==input.size();int a=base64Value(input[i]),b=base64Value(input[i+1]),c=input[i+2]=='='?0:base64Value(input[i+2]),d=input[i+3]=='='?0:base64Value(input[i+3]);if(a<0||b<0||c<0||d<0||(!last&&(input[i+2]=='='||input[i+3]=='='))||(input[i+2]=='='&&input[i+3]!='=')||(input[i+2]=='='&&(b&15))||(input[i+3]=='='&&input[i+2]!='='&&(c&3)))throw std::runtime_error("invalid base64");unsigned int bits=(a<<18)|(b<<12)|(c<<6)|d;output.push_back(static_cast<char>(bits>>16));if(input[i+2]!='=')output.push_back(static_cast<char>(bits>>8));if(input[i+3]!='=')output.push_back(static_cast<char>(bits));}return output; }
std::string encodeBase64(const std::string& input) { static constexpr char alphabet[]="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";std::string output;output.reserve(((input.size()+2)/3)*4);for(size_t i=0;i<input.size();i+=3){const size_t remaining=input.size()-i;const unsigned int a=static_cast<unsigned char>(input[i]),b=remaining>1?static_cast<unsigned char>(input[i+1]):0,c=remaining>2?static_cast<unsigned char>(input[i+2]):0;output.push_back(alphabet[a>>2]);output.push_back(alphabet[((a&3)<<4)|(b>>4)]);output.push_back(remaining>1?alphabet[((b&15)<<2)|(c>>6)]:'=');output.push_back(remaining>2?alphabet[c&63]:'=');}return output; }
long long base64Encode(const std::string& input,const std::string& expected) { long long total=0;for(long long i=0;i<n;i++)if(encodeBase64(input)==expected)total++;return total; }
long long base64Decode(const std::string& encoded,const std::string& expected) { long long total=0;for(long long i=0;i<n;i++)if(decodeBase64(encoded)==expected)total++;return total; }
long long filesystemRead(const std::string& path) { std::ifstream input(path,std::ios::binary); if(!input)return -1; std::string value((std::istreambuf_iterator<char>(input)),{}); return static_cast<long long>(value.size()); }
struct Stats { double min,median,p95,max,cv; int samples; long long runs,checksum; };
template<class F> Stats measure(F work,int samples,double targetMs) {
  for(int i=0;i<2;i++) sink=work();
  constexpr long long maximumRuns=1'048'576;
  long long runs=1; double elapsedMs=0;
  for(;;) { auto start=Clock::now(); for(long long i=0;i<runs;i++) sink=work(); elapsedMs=std::chrono::duration<double,std::milli>(Clock::now()-start).count(); if(elapsedMs>=targetMs||runs==maximumRuns) break; runs=std::min(runs*2,maximumRuns); }
  if(elapsedMs<targetMs) throw std::runtime_error("C++ benchmark could not reach the sample target");
  const long long checksum=work(); std::vector<double> values; values.reserve(samples);
  for(int s=0;s<samples;s++) { auto start=Clock::now(); for(long long i=0;i<runs;i++) { const auto value=work(); if(value!=checksum) std::abort(); sink=value; } values.push_back(std::chrono::duration<double,std::milli>(Clock::now()-start).count()); }
  auto sorted=values; std::sort(sorted.begin(),sorted.end()); const double mean=std::accumulate(values.begin(),values.end(),0.0)/values.size(); double variance=0; for(double value:values) variance+=(value-mean)*(value-mean); variance/=values.size();
  return {sorted.front(),sorted[sorted.size()/2],sorted[static_cast<size_t>(sorted.size()*.95)],sorted.back(),mean==0?0:std::sqrt(variance)/mean,samples,runs,checksum};
}
void emit(const char* name,Stats s,long long ops,double targetMs) {
  std::cout<<'"'<<name<<"\":{"<<"\"samples\":"<<s.samples<<",\"warmup\":2,\"targetSampleMs\":"<<targetMs<<",\"runsPerSample\":"<<s.runs<<",\"operationsPerSample\":"<<s.runs*ops<<",\"minMs\":"<<s.min<<",\"medianMs\":"<<s.median<<",\"p95Ms\":"<<s.p95<<",\"maxMs\":"<<s.max<<",\"coefficientOfVariation\":"<<s.cv<<",\"checksum\":\""<<s.checksum<<"\"}";
}
int main(int argc,char** argv) {
  if(argc<9) return 2; const std::string haystack=argv[1],needle=argv[2],path=argv[3],base64Encoded=argv[6],base64Payload=argv[7]; volatile long long collatzInput=std::stoll(argv[8]);
  const int samples=std::stoi(argv[4]); const double targetMs=std::stod(argv[5]);
  auto stringWork=[&](){return stringSearch(haystack,needle);}; auto fsWork=[&](){return filesystemRead(path);};
  std::string scanText; if(argc>10) { std::ifstream scanInput(argv[10],std::ios::binary); if(!scanInput) return 3; scanText.assign(std::istreambuf_iterator<char>(scanInput),{}); }
  auto scanWork=[&](){return argc>10?textScan(scanText):-1;};
  if(argc>9&&std::string(argv[9])=="recursiveCalls") { std::cout<<"{\"version\":9,\"workloads\":{";emit("recursiveCalls",measure(recursiveCalls,samples,targetMs),1,targetMs);std::cout<<',';emit("recursiveCallsWithBmecLimits",measure(recursiveCallsWithBmecLimits,samples,targetMs),1,targetMs);std::cout<<"}}\n";return 0; }
  if(argc>9&&std::string(argv[9])=="enumConstructionMatching") { std::cout<<"{\"version\":9,\"workloads\":{";emit("enumConstructionMatching",measure(enumConstructionMatching,samples,targetMs),n,targetMs);std::cout<<"}}\n";return 0; }
  if(argc>9&&std::string(argv[9])=="optionalMatch") { std::cout<<"{\"version\":9,\"workloads\":{";emit("optionalMatch",measure(optionalMatch,samples,targetMs),n,targetMs);std::cout<<"}}\n";return 0; }
  if(argc>9&&std::string(argv[9])=="resultMatch") { std::cout<<"{\"version\":9,\"workloads\":{";emit("resultMatch",measure(resultMatch,samples,targetMs),n,targetMs);std::cout<<"}}\n";return 0; }
  if(argc>9&&std::string(argv[9])=="branchMutation") { std::cout<<"{\"version\":9,\"workloads\":{";emit("branchMutation",measure(branchMutation,samples,targetMs),n,targetMs);std::cout<<"}}\n";return 0; }
  if(argc>9&&std::string(argv[9])=="recordAccess") { std::cout<<"{\"version\":9,\"workloads\":{";emit("recordAccess",measure(recordAccess,samples,targetMs),n,targetMs);std::cout<<"}}\n";return 0; }
  if(argc>9&&std::string(argv[9])=="filterTextList") { std::cout<<"{\"version\":9,\"workloads\":{";emit("filterTextList",measure(filterTextList,samples,targetMs),n*4,targetMs);std::cout<<"}}\n";return 0; }
  if(argc>9&&std::string(argv[9])=="foldTextList") { std::cout<<"{\"version\":9,\"workloads\":{";emit("foldTextList",measure(foldTextList,samples,targetMs),n*4,targetMs);std::cout<<"}}\n";return 0; }
  if(argc>9&&std::string(argv[9])=="textConcat") { std::cout<<"{\"version\":9,\"workloads\":{";emit("textConcat",measure(textConcat,samples,targetMs),n*2,targetMs);std::cout<<"}}\n";return 0; }
  if(argc>9&&std::string(argv[9])=="mapTextList") { std::cout<<"{\"version\":9,\"workloads\":{";emit("mapTextList",measure(mapTextList,samples,targetMs),n*4,targetMs);std::cout<<"}}\n";return 0; }
  if(argc>9&&std::string(argv[9])=="nestedLoops") { std::cout<<"{\"version\":9,\"workloads\":{";emit("nestedLoops",measure(nestedLoops,samples,targetMs),nestedLoopOperations,targetMs);std::cout<<"}}\n";return 0; }
  if(argc>9&&std::string(argv[9])=="base64Encode") { std::cout<<"{\"version\":10,\"workloads\":{";emit("base64Encode",measure([&](){return base64Encode(base64Payload,base64Encoded);},samples,targetMs),n,targetMs);std::cout<<"}}\n";return 0; }
  if(argc>9&&std::string(argv[9])=="stringSearch") { std::cout<<"{\"version\":10,\"workloads\":{";emit("stringSearch",measure(stringWork,samples,targetMs),n,targetMs);std::cout<<"}}\n";return 0; }
  if(argc>9&&std::string(argv[9])=="textScan") { std::cout<<"{\"version\":10,\"workloads\":{";emit("textScan",measure(scanWork,samples,targetMs),128,targetMs);std::cout<<"}}\n";return 0; }
  std::cout<<"{\"version\":10,\"workloads\":{";
  emit("integerLoop",measure(integerLoop,samples,targetMs),n,targetMs);std::cout<<',';
  emit("functionCalls",measure(functionCalls,samples,targetMs),n,targetMs);std::cout<<',';
  emit("numberLoop",measure(numberLoop,samples,targetMs),n,targetMs);std::cout<<',';
  emit("stringSearch",measure(stringWork,samples,targetMs),n,targetMs);std::cout<<',';
  emit("textScan",measure(scanWork,samples,targetMs),128,targetMs);std::cout<<',';
  emit("listIteration",measure(listIteration,samples,targetMs),n,targetMs);std::cout<<',';
  emit("nestedLoops",measure(nestedLoops,samples,targetMs),nestedLoopOperations,targetMs);std::cout<<',';
  emit("primeCount",measure(primeCount,samples,targetMs),999,targetMs);std::cout<<',';
  emit("recursiveCalls",measure(recursiveCalls,samples,targetMs),1,targetMs);std::cout<<',';
  emit("recursiveCallsWithBmecLimits",measure(recursiveCallsWithBmecLimits,samples,targetMs),1,targetMs);std::cout<<',';
  emit("enumConstructionMatching",measure(enumConstructionMatching,samples,targetMs),n,targetMs);std::cout<<',';
  emit("optionalMatch",measure(optionalMatch,samples,targetMs),n,targetMs);std::cout<<',';
  emit("resultMatch",measure(resultMatch,samples,targetMs),n,targetMs);std::cout<<',';
  emit("branchMutation",measure(branchMutation,samples,targetMs),n,targetMs);std::cout<<',';
  emit("recordAccess",measure(recordAccess,samples,targetMs),n,targetMs);std::cout<<',';
  emit("filterTextList",measure(filterTextList,samples,targetMs),n*4,targetMs);std::cout<<',';
  emit("foldTextList",measure(foldTextList,samples,targetMs),n*4,targetMs);std::cout<<',';
  emit("textConcat",measure(textConcat,samples,targetMs),n*2,targetMs);std::cout<<',';
  emit("mapTextList",measure(mapTextList,samples,targetMs),n*4,targetMs);std::cout<<',';
  auto collatzWork=[&](){guardedSteps=0;guardedDepth=0;return collatzStepsWithBmecLimits(collatzInput);};emit("collatzSteps",measure(collatzWork,samples,targetMs),1,targetMs);std::cout<<',';
  emit("jsonEncode",measure(jsonEncode,samples,targetMs),n,targetMs);std::cout<<',';
  auto base64EncodeWork=[&](){return base64Encode(base64Payload,base64Encoded);};emit("base64Encode",measure(base64EncodeWork,samples,targetMs),n,targetMs);std::cout<<',';
  auto base64Work=[&](){return base64Decode(base64Encoded,base64Payload);};emit("base64Decode",measure(base64Work,samples,targetMs),n,targetMs);std::cout<<',';
  emit("filesystemRead",measure(fsWork,samples,targetMs),1,targetMs);
  std::cout<<"}}\n";
}
