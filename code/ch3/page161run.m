
clear all; clc;
M = 10; N = 10;
p = 0;
ii = 6;
format short e
Err = zeros(1, ii);
for i = 1:ii
    MaxErr = page161(M * 2^(i - 1), N * 4^(i - 1), p);
    Err(i) = MaxErr;
end
Err
Ord = log2(Err(1:end - 1) ./ Err(2:end))