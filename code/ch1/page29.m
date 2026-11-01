N = 6;
M = 10; 
for i =1:N
  [u1,F1,MaxErr1] = Maxerr(2^(i-1)*M);
    [u2,F2,MaxErr2] = Maxerr(2^i*M);
    Err(i)=max(abs(F1-(4*u2(1:2:(2^i*M)+1)-u1)/3));
end
Ord = Err(1:N-1)./Err(2:N);