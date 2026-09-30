#include <chrono>
#include <iostream>
#include <string>

using clock_type = std::chrono::steady_clock;
template <typename F> double measure(F&& fn) {
  const auto start = clock_type::now();
  volatile long long result = fn();
  (void)result;
  return std::chrono::duration<double, std::milli>(clock_type::now() - start).count();
}
long long add(long long a, long long b) { return a + b; }
int main() {
  constexpr int n = 25000;
  std::string haystack = "BMEC benchmark";
  std::string needle = "mark";
  std::cout << "{\"integerLoopMs\":" << measure([&] { long long total=0; for(int i=0;i<n;i++) total += 1; return total; });
  std::cout << ",\"functionCallsMs\":" << measure([&] { long long total=0; for(int i=0;i<n;i++) total += add(20,22); return total; });
  std::cout << ",\"stringSearchMs\":" << measure([&] { long long total=0; for(int i=0;i<n;i++) if(haystack.find(needle)!=std::string::npos) total += 1; return total; }) << "}\n";
}
